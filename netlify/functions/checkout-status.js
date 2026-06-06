const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };

  const userId = event.queryStringParameters?.userId;
  if (!userId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'userId obrigatório' }) };

  const { data } = await supabase
    .from('usuarios')
    .select('status')
    .eq('id', userId)
    .single();

  return { statusCode: 200, headers: cors, body: JSON.stringify({ status: data?.status || 'pendente' }) };
};
