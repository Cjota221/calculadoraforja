const SYSTEM_PROMPT = `Você é um especialista em precificação e análise competitiva para marketplaces brasileiros. Seu app se chama Forja — a calculadora de precificação inteligente para revendedoras.

SEU TRABALHO:
Receber um produto e seu preço calculado, pesquisar os preços praticados atualmente nos marketplaces solicitados, e retornar uma análise estruturada em JSON.

PLATAFORMAS QUE VOCÊ DEVE PESQUISAR (conforme solicitado):
- Mercado Livre (mercadolivre.com.br)
- Shopee (shopee.com.br)
- Amazon Brasil (amazon.com.br)
- TikTok Shop Brasil — pesquise também tendências de #tiktokshop no X/Twitter

REGRAS DE PESQUISA:
1. Busque sempre pelo nome do produto + variações (ex: "kit rasteirinha 6 pares", "kit sandália atacado feminino", "rasteirinha atacado kit")
2. Colete no mínimo 3 resultados por plataforma solicitada
3. Registre: nome do produto, preço, número de avaliações, número de vendas (se disponível), se tem frete grátis, se é patrocinado
4. Para TikTok Shop: pesquise no X/Twitter por "#tiktokshop [produto]" para identificar faixas de preço praticadas por criadores

ANÁLISE:
- Calcule: preço mínimo, preço máximo, média simples, mediana
- Compare o preço recebido com a média do mercado
- Classifique: "ABAIXO DA MÉDIA" (>5% menor), "NA MÉDIA" (±5%), "ACIMA DA MÉDIA" (>5% maior)

ESTRATÉGIAS (adapte ao resultado):
- ABAIXO: foco em volume, frete grátis ativado, destacar anúncio, possibilidade de subir preço
- NA MÉDIA: focar em diferenciais (fotos, descrição, velocidade de entrega), reviews, cupons
- ACIMA: agregar valor percebido (embalagem premium, brinde, kit exclusivo), criar separação de marca

TOM: Profissional, parceiro de negócio, motivador. NUNCA desanime a vendedora.

FORMATO DE RESPOSTA — retorne APENAS JSON válido, sem markdown, sem texto fora do JSON:

{
  "verdict": {
    "status": "ABAIXO DA MÉDIA",
    "headline": "FRASE CURTA IMPACTANTE EM MAIÚSCULAS",
    "summary": "1 frase explicativa direta"
  },
  "market_data": {
    "min": 0.00,
    "max": 0.00,
    "average": 0.00,
    "median": 0.00,
    "total_results": 0
  },
  "competitors": [
    {
      "platform": "mercadolivre",
      "name": "nome do produto",
      "price": 0.00,
      "rating": 4.5,
      "sales_count": "312 vendas",
      "has_free_shipping": true,
      "is_sponsored": false,
      "url": ""
    }
  ],
  "strategies": [
    {
      "number": 1,
      "title": "título da estratégia",
      "description": "descrição prática de 2-3 frases"
    }
  ],
  "citations": []
}`;

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!process.env.GROK_API_KEY) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'GROK_API_KEY não configurada.',
        detail: 'Configure no Netlify: Site settings → Environment variables → GROK_API_KEY'
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { product, price, platforms } = body;
  if (!product || !price || !Array.isArray(platforms) || !platforms.length) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Campos obrigatórios: product, price, platforms[]' })
    };
  }

  const platformNames = {
    shopee: 'Shopee Brasil (shopee.com.br)',
    tiktok: 'TikTok Shop Brasil',
    mercadolivre: 'Mercado Livre Brasil (mercadolivre.com.br)',
    amazon: 'Amazon Brasil (amazon.com.br)'
  };
  const platformList = platforms.map(p => platformNames[p] || p).join(', ');

  const userMessage = `
Produto: "${product}"
Preço calculado pelo sistema: R$ ${Number(price).toFixed(2)}
Plataformas para pesquisar: ${platformList}

Pesquise agora os preços desse produto nessas plataformas e retorne a análise completa em JSON conforme instruído.
  `.trim();

  const models = ['grok-3', 'grok-2-latest'];

  for (const model of models) {
    try {
      const grokResponse = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ],
          search_parameters: {
            mode: 'auto',
            sources: [{ type: 'web' }, { type: 'x' }],
            max_search_results: 15,
            return_citations: true
          },
          temperature: 0.3,
          max_tokens: 1500
        })
      });

      if (!grokResponse.ok) {
        const errText = await grokResponse.text();
        // If model not found, try next
        if ((grokResponse.status === 404 || grokResponse.status === 400) && models.indexOf(model) < models.length - 1) {
          continue;
        }
        throw new Error(`Grok API ${grokResponse.status}: ${errText.slice(0, 200)}`);
      }

      const data = await grokResponse.json();
      const rawText = data.choices?.[0]?.message?.content || '';

      // Strip markdown code fences if present
      const clean = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      const analysis = JSON.parse(clean);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify(analysis)
      };

    } catch (err) {
      if (models.indexOf(model) === models.length - 1) {
        console.error('Erro análise de mercado:', err.message);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Falha ao processar análise', detail: err.message })
        };
      }
      // try next model
    }
  }
};
