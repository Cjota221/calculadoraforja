const { MercadoPagoConfig, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const paymentClient = new Payment(client);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  // Sempre retorna 200 para o Mercado Pago não retentar indefinidamente
  if (event.httpMethod === 'GET') return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  if (event.httpMethod !== 'POST') return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  try {
    const body = JSON.parse(event.body || '{}');
    if (body.type !== 'payment') return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    const paymentId = String(body.data?.id);
    const payment = await paymentClient.get({ id: paymentId });
    if (payment.status !== 'approved') return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    // Idempotência: já foi ativado com esse payment_id?
    const { data: jaAtivo } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .eq('mp_payment_id', paymentId)
      .eq('status', 'ativo')
      .single();
    if (jaAtivo) return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    // Buscar usuário pelo external_reference
    const { data: usuario } = await supabaseAdmin
      .from('usuarios')
      .select('*')
      .eq('mp_external_ref', payment.external_reference)
      .single();
    if (!usuario) return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    // Update atômico — só muda se ainda estiver 'pendente'
    const { data: atualizado } = await supabaseAdmin
      .from('usuarios')
      .update({
        status: 'ativo',
        mp_payment_id: paymentId,
        ativado_em: new Date().toISOString()
      })
      .eq('id', usuario.id)
      .eq('status', 'pendente')
      .select();

    if (!atualizado?.length) return { statusCode: 200, body: JSON.stringify({ ok: true }) };

    // Confirmar email no Auth para permitir login
    if (usuario.auth_user_id) {
      await supabaseAdmin.auth.admin.updateUserById(usuario.auth_user_id, {
        email_confirm: true
      });
    }

    // TODO: disparar e-mail de boas-vindas / WhatsApp via n8n
    // await fetch(process.env.N8N_WEBHOOK_URL, { method: 'POST', body: JSON.stringify({ usuario }) })

    console.log(`[Forja] Usuário ativado: ${usuario.email} — Payment ${paymentId}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('[Forja webhook]', err.message);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) }; // SEMPRE 200
  }
};
