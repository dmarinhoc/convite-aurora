// ============================================================
// Worker "aurora-rsvp" — API de confirmação de presença
// Festa da Aurora (2 aninhos, tema Joaninha) — 05/09/2026
//
// Como editar a lista de convidados:
// 1. Adicione/edite um item no array GUEST_LIST abaixo.
// 2. "token" é o código que vai na URL do convite (ex: ?c=abc123).
//    Use só letras minúsculas e números, e não repita tokens.
// 3. Cole este arquivo inteiro no editor do Worker (Cloudflare
//    dashboard > Workers > aurora-rsvp > Edit code) e clique em Deploy.
// ============================================================

const GUEST_LIST = [
  { token: "pcdyn8", label: "Família Marinho", people: ["Dalmo Marinho", "Philip Russo"] },
  { token: "y8yya5", label: "Djanine Carolina", people: ["Djanine Carolina"] },
  { token: "wry95e", label: "Família Paula", people: ["Luiza Marinho Paula", "Rafael Paula"] },
];

const RSVP_DEADLINE = "2026-08-23";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

function findGuest(token) {
  return GUEST_LIST.find((g) => g.token === token) || null;
}

function computeStatus(record) {
  if (!record) return "pendente";
  const attendingFlags = record.people.map((p) => p.attending);
  if (attendingFlags.every((a) => a === true)) return "confirmado";
  if (attendingFlags.every((a) => a === false)) return "nao_vem";
  return "parcial";
}

async function handleGetGuest(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const guest = findGuest(token);
  if (!guest) return json({ ok: false, error: "convite_nao_encontrado" }, 404);

  const raw = await env.RSVP_KV.get(`rsvp:${token}`);
  const record = raw ? JSON.parse(raw) : null;

  return json({
    ok: true,
    label: guest.label,
    people: guest.people,
    deadline: RSVP_DEADLINE,
    response: record
      ? { people: record.people, message: record.message || "", respondedAt: record.respondedAt }
      : null,
    status: computeStatus(record),
  });
}

async function handlePostRsvp(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.token) return json({ ok: false, error: "requisicao_invalida" }, 400);

  const guest = findGuest(body.token);
  if (!guest) return json({ ok: false, error: "convite_nao_encontrado" }, 404);

  if (!Array.isArray(body.people) || body.people.length !== guest.people.length) {
    return json({ ok: false, error: "lista_de_pessoas_invalida" }, 400);
  }
  const validNames = new Set(guest.people);
  for (const p of body.people) {
    if (!validNames.has(p.name) || typeof p.attending !== "boolean") {
      return json({ ok: false, error: "lista_de_pessoas_invalida" }, 400);
    }
  }

  const record = {
    people: body.people,
    message: typeof body.message === "string" ? body.message.slice(0, 500) : "",
    respondedAt: new Date().toISOString(),
  };

  await env.RSVP_KV.put(`rsvp:${body.token}`, JSON.stringify(record));
  return json({ ok: true, status: computeStatus(record) });
}

async function handleAdminReset(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || body.pw !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "senha_invalida" }, 401);
  }

  const tokens = Array.isArray(body.tokens) && body.tokens.length > 0
    ? body.tokens
    : GUEST_LIST.map((g) => g.token);

  await Promise.all(tokens.map((t) => env.RSVP_KV.delete(`rsvp:${t}`)));
  return json({ ok: true, cleared: tokens });
}

async function handleAdmin(request, env) {
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw");
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "senha_invalida" }, 401);
  }

  const results = await Promise.all(
    GUEST_LIST.map(async (guest) => {
      const raw = await env.RSVP_KV.get(`rsvp:${guest.token}`);
      const record = raw ? JSON.parse(raw) : null;
      return {
        token: guest.token,
        label: guest.label,
        people: guest.people,
        status: computeStatus(record),
        response: record
          ? { people: record.people, message: record.message || "", respondedAt: record.respondedAt }
          : null,
      };
    })
  );

  return json({ ok: true, deadline: RSVP_DEADLINE, guests: results });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/guest" && request.method === "GET") {
        return await handleGetGuest(request, env);
      }
      if (url.pathname === "/rsvp" && request.method === "POST") {
        return await handlePostRsvp(request, env);
      }
      if (url.pathname === "/admin" && request.method === "GET") {
        return await handleAdmin(request, env);
      }
      if (url.pathname === "/admin/reset" && request.method === "POST") {
        return await handleAdminReset(request, env);
      }
      return json({ ok: false, error: "rota_nao_encontrada" }, 404);
    } catch (err) {
      return json({ ok: false, error: "erro_interno", detail: String(err) }, 500);
    }
  },
};
