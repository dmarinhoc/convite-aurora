// ============================================================
// Worker "aurora-rsvp" — API de confirmação de presença
// Festa da Aurora (2 aninhos, tema Joaninha) — 06/09/2026
//
// Como editar a lista de convidados:
// 1. Adicione/edite um item no array GUEST_LIST abaixo.
// 2. "token" é o código que vai na URL do convite (ex: ?c=abc123).
//    Use só letras minúsculas e números, e não repita tokens.
// 3. Cole este arquivo inteiro no editor do Worker (Cloudflare
//    dashboard > Workers > aurora-rsvp > Edit code) e clique em Deploy.
//
// Fotos da festa: precisa de um bucket R2 chamado "aurora-rsvp-fotos"
// (Storage & databases > R2 Object Storage > Create bucket), depois
// bindar no Worker (Settings > Bindings > Add binding > R2 Bucket)
// com o nome de variável PHOTOS_BUCKET.
// ============================================================

const GUEST_LIST = [
  { token: "wapce7", label: "Família Paula (Célia)", people: ["Celia Paula", "José Carlos de Paula", "Marina da Cruz", "Juliana Noemia", "Rafael Lopes"] },
  { token: "zyfy2v", label: "Elisabete & Cristóvão", people: ["Elisabete Noémia", "Cristóvão"] },
  { token: "rw79km", label: "Família De Paula", people: ["Tiago de Paula", "Sorreyla de Paula", "Gabriel de Paula"] },
  { token: "yabsge", label: "Família Mainarte", people: ["Luiza Marinho", "Beatriz Mainarte", "Wanderlei Mainarte"] },
  { token: "bbb56p", label: "Siqueira", people: ["Laura Siqueira", "Joyce Siqueira", "Warley Siqueira"] },
  { token: "wpjqze", label: "Álvaro e Valéria", people: ["Álvaro", "Valéria"] },
  { token: "ndgp47", label: "Família Nuvem", people: ["Felipe Nuvem", "Joyce Nuvem"] },
  { token: "24czfm", label: "Vovó", people: ["Angela Carmo", "Dalmo Carmo"] },
  { token: "hjchrr", label: "Dalmo e Phil", people: ["Dalmo", "Phil"] },
  { token: "kjmj63", label: "Dede", people: ["Dede"] },
  { token: "7m429u", label: "Luana", people: ["Luana"] },
  { token: "a5j5ce", label: "Família Paula (Alessandro)", people: ["Alessandro", "Mateus", "João Vitor"] },
  { token: "5psdeh", label: "Denise", people: ["Denise"] },
  { token: "46mwmt", label: "Família Assis", people: ["Elisangela Assis", "Renato Assis", "Maria Eduarda Assis", "Brenda Assis", "Marcos Assis"] },
  { token: "8scrfe", label: "Giovane e Bárbara", people: ["Giovane", "Bárbara"] },
  { token: "at5eaj", label: "Família Bicalho", people: ["Rafael Bicalho", "Camila Russo"] },
  { token: "5cbsez", label: "Família Garcia", people: ["Cândida Garcia", "Jessica Garcia", "Júlia Garcia", "Nicole Garcia", "Vanessa Garcia"] },
  { token: "2bv3th", label: "Família Eloy", people: ["Gabriela Eloy", "Ana Beatriz Eloy", "Maria Eloy"] },
  { token: "f2b3vs", label: "Bruno e Mayra", people: ["Bruno", "Mayra"] },
  { token: "ucwa9x", label: "João Victor e Sammaany", people: ["João Victor", "Sammaany"] },
];

const RSVP_DEADLINE = "2026-08-21";

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

const MAX_PHOTO_SIZE = 25 * 1024 * 1024; // 25MB por arquivo

async function handleUploadPhotos(request, env) {
  const formData = await request.formData().catch(() => null);
  if (!formData) return json({ ok: false, error: "requisicao_invalida" }, 400);

  const files = formData.getAll("files");
  if (!files.length) return json({ ok: false, error: "nenhum_arquivo" }, 400);

  let uploaded = 0;
  let rejected = 0;

  for (const file of files) {
    const isFile = file && typeof file === "object" && "arrayBuffer" in file;
    if (!isFile) continue;
    if (file.size > MAX_PHOTO_SIZE) { rejected++; continue; }
    if (!/^image\/|^video\//.test(file.type)) { rejected++; continue; }

    const safeName = (file.name || "arquivo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
    const key = `photo/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    await env.PHOTOS_BUCKET.put(key, file, { httpMetadata: { contentType: file.type } });
    uploaded++;
  }

  if (!uploaded) return json({ ok: false, error: "nenhum_arquivo_valido" }, 400);
  return json({ ok: true, uploaded, rejected });
}

async function handleListPhotos(request, env) {
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw");
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "senha_invalida" }, 401);
  }

  const listed = await env.PHOTOS_BUCKET.list({ limit: 1000, include: ["httpMetadata"] });
  const photos = listed.objects
    .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))
    .map((obj) => ({
      key: obj.key,
      size: obj.size,
      uploaded: obj.uploaded,
      contentType: obj.httpMetadata?.contentType || "",
    }));

  return json({ ok: true, count: photos.length, photos });
}

async function handlePhotoFile(request, env) {
  const url = new URL(request.url);
  const pw = url.searchParams.get("pw");
  const key = url.searchParams.get("key");
  if (!env.ADMIN_PASSWORD || pw !== env.ADMIN_PASSWORD) {
    return new Response("Não autorizado", { status: 401, headers: CORS_HEADERS });
  }
  if (!key) return new Response("Chave inválida", { status: 400, headers: CORS_HEADERS });

  const obj = await env.PHOTOS_BUCKET.get(key);
  if (!obj) return new Response("Não encontrado", { status: 404, headers: CORS_HEADERS });

  const headers = new Headers(CORS_HEADERS);
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "private, max-age=3600");
  return new Response(obj.body, { headers });
}

async function handleDeletePhoto(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || body.pw !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: "senha_invalida" }, 401);
  }
  if (!body.key) return json({ ok: false, error: "chave_invalida" }, 400);

  await env.PHOTOS_BUCKET.delete(body.key);
  return json({ ok: true });
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
      if (url.pathname === "/photos" && request.method === "POST") {
        return await handleUploadPhotos(request, env);
      }
      if (url.pathname === "/photos/list" && request.method === "GET") {
        return await handleListPhotos(request, env);
      }
      if (url.pathname === "/photos/file" && request.method === "GET") {
        return await handlePhotoFile(request, env);
      }
      if (url.pathname === "/photos/delete" && request.method === "POST") {
        return await handleDeletePhoto(request, env);
      }
      return json({ ok: false, error: "rota_nao_encontrada" }, 404);
    } catch (err) {
      return json({ ok: false, error: "erro_interno", detail: String(err) }, 500);
    }
  },
};
