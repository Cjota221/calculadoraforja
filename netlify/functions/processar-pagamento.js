const { MercadoPagoConfig, Payment, CardToken } = require('mercadopago');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const paymentClient = new Payment(client);
const cardTokenClient = new CardToken(client);

const AMOUNT = parseFloat(process.env.MP_PRICE || '99.90');
const DESCRIPTION = 'Forja Vitalicio';
const PRIORITY = ['visa', 'master', 'elo', 'amex', 'hipercard', 'diners', 'cabal', 'debvisa', 'debmaster', 'debelo'];
const WEBHOOK_URL = process.env.MP_WEBHOOK_URL || `${process.env.NEXT_PUBLIC_URL}/webhook-mercadopago`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'JSON invalido' }) };
  }

  const { method, email, externalRef, card } = body;

  if (method === 'pix') {
    try {
      const payment = await paymentClient.create({
        body: {
          transaction_amount: AMOUNT,
          payment_method_id: 'pix',
          description: DESCRIPTION,
          external_reference: externalRef,
          notification_url: WEBHOOK_URL,
          payer: { email }
        }
      });

      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          paymentId: payment.id,
          qrCode: payment.point_of_interaction?.transaction_data?.qr_code,
          qrCodeBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64
        })
      };
    } catch (err) {
      console.error('[Forja PIX]', err.message);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Erro ao gerar PIX. Tente novamente.' }) };
    }
  }

  if (method === 'card') {
    const { cardNumber, expirationMonth, expirationYear, cvv, cardholderName, cpf } = card || {};
    if (!cardNumber || !expirationMonth || !expirationYear || !cvv || !cardholderName || !cpf) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Dados do cartao incompletos.' }) };
    }

    try {
      const bin = cardNumber.replace(/\s/g, '').substring(0, 8);
      const binRes = await fetch(
        `https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&public_key=${process.env.MP_PUBLIC_KEY}`,
        { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
      );
      const binData = await binRes.json();

      const ranked = (binData.results || [])
        .filter((r) => PRIORITY.includes(r.id))
        .sort((a, b) => PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id));

      const paymentMethod = ranked[0]
        ?? (binData.results || []).find((r) => r.payment_type_id === 'credit_card')
        ?? (binData.results || []).find((r) => r.payment_type_id === 'debit_card');

      if (!paymentMethod) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Bandeira do cartao nao identificada.' }) };
      }

      const tokenData = await cardTokenClient.create({
        body: {
          card_number: cardNumber.replace(/\s/g, ''),
          expiration_month: String(expirationMonth),
          expiration_year: expirationYear.length === 2 ? `20${expirationYear}` : expirationYear,
          security_code: String(cvv),
          cardholder: {
            name: cardholderName,
            identification: { type: 'CPF', number: cpf.replace(/\D/g, '') }
          }
        }
      });

      const payment = await paymentClient.create({
        body: {
          transaction_amount: AMOUNT,
          token: tokenData.id,
          payment_method_id: paymentMethod.id,
          installments: 1,
          issuer_id: paymentMethod.issuer?.id,
          description: DESCRIPTION,
          external_reference: externalRef,
          notification_url: WEBHOOK_URL,
          payer: {
            email,
            identification: { type: 'CPF', number: cpf.replace(/\D/g, '') }
          }
        }
      });

      if (payment.status === 'rejected') {
        const motivos = {
          cc_rejected_insufficient_amount: 'Saldo insuficiente.',
          cc_rejected_bad_filled_card_number: 'Numero do cartao invalido.',
          cc_rejected_bad_filled_date: 'Data de validade invalida.',
          cc_rejected_bad_filled_security_code: 'CVV invalido.',
          cc_rejected_blacklist: 'Cartao nao autorizado.',
          cc_rejected_call_for_authorize: 'Ligue para o banco para autorizar.',
          cc_rejected_high_risk: 'Pagamento recusado por seguranca.',
          cc_rejected_max_attempts: 'Muitas tentativas. Tente outro cartao.'
        };
        const detalhe = payment.status_detail || '';
        return {
          statusCode: 400,
          headers: cors,
          body: JSON.stringify({ error: motivos[detalhe] || 'Pagamento recusado. Tente outro cartao.' })
        };
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ paymentId: payment.id, status: payment.status }) };
    } catch (err) {
      console.error('[Forja Card]', err.message);
      return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Erro ao processar pagamento. Tente novamente.' }) };
    }
  }

  return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Metodo invalido.' }) };
};
