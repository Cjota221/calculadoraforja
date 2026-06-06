const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { nome, email, telefone } = body;
  if (!nome || !email) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'nome e email são obrigatórios' }) };

  // Verificar se já tem acesso ativo
  const { data: existente } = await supabaseAdmin
    .from('usuarios')
    .select('id, status')
    .eq('email', email)
    .single();

  if (existente?.status === 'ativo') {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Este e-mail já possui acesso ativo.' }) };
  }

  // Criar usuário no Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-4).toUpperCase(),
    email_confirm: false
  });

  if (authError && !authError.message.includes('already registered')) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: authError.message }) };
  }

  const authUserId = authData?.user?.id || existente?.id;
  const externalRef = `forja_${authUserId || email.replace(/[^a-z0-9]/gi, '_')}`;

  const { data: usuario, error } = await supabaseAdmin
    .from('usuarios')
    .upsert({
      auth_user_id: authUserId,
      nome,
      email,
      telefone: telefone || null,
      status: 'pendente',
      plano: 'vitalicio',
      mp_external_ref: externalRef
    }, { onConflict: 'email' })
    .select()
    .single();

  if (error) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: error.message }) };

  return { statusCode: 200, headers: cors, body: JSON.stringify({ userId: usuario.id, externalRef: usuario.mp_external_ref }) };
};
