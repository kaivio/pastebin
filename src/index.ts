import handleProxy from './proxy';
import handleRedirect from './redirect';
import { Router } from 'itty-router';
// now let's create a router (note the lack of "new")
const router = Router();

export interface Env {
  // If you set another name in wrangler.toml as the value for 'binding',
  // replace "DB" with the variable name you defined.
  DB: D1Database;
}

interface Paste {
  id: string,
  type: string,
  content: Uint8Array
}

async function paste_read(db: D1Database, id: string): Promise<Paste | null> {
  const res: Paste | null = await db.prepare("SELECT * FROM v1 WHERE id = ?")
    .bind(id)
    .first()
  return res
}

async function paste_write(db: D1Database, data: Paste): Promise<string> {
  let { id, type, content } = data
  try {
    id = id || await paste_autoid(db)
    let exist = await db.prepare("SELECT id FROM v1 WHERE id = ?")
      .bind(id)
      .first()
    if (exist) {
      if (/^[0-9]/.test(id)){
        return 'The paste is read-only'
      }
      db.prepare("UPDATE  v1  SET type = ?, content = ? WHERE id = ?")
        .bind(type, content, id)
        .run()
    } else {
      await db.prepare("INSERT INTO v1 (id, type, content) VALUES (?,?,?)")
        .bind(id, type, content)
        .run()
    }
  } catch (e: any) {
    console.log(e);
    
    return 'Error: write failed.'
  }

  return id
}

async function paste_autoid(db: D1Database): Promise<string> {
  let meta_row = await db.prepare("SELECT * FROM v1 WHERE id = ?")
    .bind('.')
    .first()

  let n = 0

  if (meta_row) {
    let type: any = meta_row.type
    let data = JSON.parse(type)
    n = ++data.auto_seq
    type = JSON.stringify(data)

    db.prepare("UPDATE  v1  SET type = ? WHERE id = ?")
      .bind(type, '.')
      .run()


  } else {
    meta_row = {
      id: '.',
      type: JSON.stringify({
        auto_seq: 0
      }),
      content: null
    }

    await db.prepare("INSERT INTO v1 (id, type, content) VALUES (?,?,?)")
      .bind(meta_row.id, meta_row.type, meta_row.content)
      .run()

  }

  return '' + n
}


router.get('/', (req, env, ctx) => {
  // env.entry_url 
  let entry_url = 'http://localhost:8787'
  return new Response(`# Post paste
curl ${entry_url}/:id  --data-binary @file.txt
    \n`)
});



router.get('/:id', async (req, env, ctx) => {
  let { id } = req.params
  let res = await paste_read(env.DB, id)
  let content = res?.content || []

  let text = ''
  let text_headers = { 'content-type': 'text/plain' }

  try {
    const arrayBuffer = new ArrayBuffer(content.length * Uint8Array.BYTES_PER_ELEMENT);
    const typedArray = new Uint8Array(arrayBuffer);
    // 将普通数组的值复制到 TypedArray 中
    for (let i = 0; i < content.length; i++) {
      typedArray[i] = content[i];
    }

    const decoder = new TextDecoder('utf-8');
    text = decoder.decode(arrayBuffer);
  } catch (e) {

  }
  // return new Response(res)
  return new Response(text, {
    headers: {

      'x-is-Uint8Array': (typeof content) + ' ' + (content instanceof Uint8Array),
      'x-is-Array': (typeof content) + ' ' + (content instanceof Array),
      'x-is-ArrayBuffer': (typeof content) + ' ' + (content instanceof ArrayBuffer),
      'x-is-decode-ok': text.length + '',
    }
  })
});

router.post('/:id?', async (req, env, ctx) => {
  let { id } = req.params
  let content: Uint8Array = await req.arrayBuffer()
  let type = 'raw'
  let res: string = await paste_write(env.DB, { id, type, content })
  return new Response(res)
});

// 404 for everything else
router.all('*', () => new Response('Not Found.\n', { status: 404 }));


// Export a default object containing event handlers
export default {
  // The fetch handler is invoked when this worker receives a HTTP(S) request
  // and should return a Response (optionally wrapped in a Promise)
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // You'll find it helpful to parse the request.url string into a URL object. Learn more at https://developer.mozilla.org/en-US/docs/Web/API/URL
    const url = new URL(request.url);

    // You can get pretty far with simple logic like if/switch-statements
    switch (url.pathname) {
      case '/api/redirect':
        return handleRedirect.fetch(request, env, ctx);

      case '/api/proxy':
        return handleProxy.fetch(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/')) {
      // You can also use more robust routing
      return new Response(
        `Try making requests to:
      <ul>
      <li><code><a href="/apl/redirect?redirectUrl=https://example.com/">/redirect?redirectUrl=https://example.com/</a></code>,</li>
      <li><code><a href="/api/proxy?modify&proxyUrl=https://example.com/">/proxy?modify&proxyUrl=https://example.com/</a></code>, or</li>
			`,
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    return await router.handle(request, env, ctx);
  },
};
