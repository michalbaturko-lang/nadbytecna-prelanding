// Bounded retries for read-only Graph GETs. Never repeat a database commit or a mailbox write.
const transient = new Set([408, 500, 502, 503, 504]);
const error = code => Object.assign(new Error('Microsoft 365 read-only operation failed.'), { name:'M365ReadError', code });
export function graphRetryAfter(headers, now=Date.now()) {
  const value=headers?.get?.('retry-after');
  if (/^\d{1,6}$/.test(value||'')) return Math.max(1,Math.min(Number(value),86400));
  const date=Date.parse(value);return Number.isFinite(date)?Math.max(1,Math.min(86400,Math.ceil((date-now)/1000))):null;
}
export async function graphGet({url,headers,fetcher=fetch,consume,timeoutMs=30000,attempts=2,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  for(let attempt=0;attempt<attempts;attempt++) {
    const controller=new AbortController();
    let timer,response,retryDelay=1000;
    const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(error('timeout'));},timeoutMs);});
    try {
      return await Promise.race([timedOut,(async()=>{
        try {response=await fetcher(url,{method:'GET',headers,redirect:'error',cache:'no-store',signal:controller.signal});}
        catch(e){throw error(controller.signal.aborted||['TimeoutError','AbortError'].includes(e?.name)?'timeout':'network_error');}
        if(response.redirected)throw error('http_error');
        const retry=graphRetryAfter(response.headers);
        if(response.status===429 || (transient.has(response.status)&&retry>2)) {
          const e=error('throttled');if(retry)e.retryAfterSeconds=retry;throw e;
        }
        if(transient.has(response.status)) {
          const e=error('http_error');e.transient=true;retryDelay=(retry||1)*1000;throw e;
        }
        return await consume(response);
      })()]);
    } catch(cause) {
      const code=controller.signal.aborted?'timeout':cause?.code;
      const retryable=['timeout','network_error'].includes(code)||cause?.transient===true;
      if(!retryable||attempt+1>=attempts) {
        const out=error(['timeout','network_error','throttled','http_error','authentication_failed','source_missing','cursor_expired','invalid_response','response_too_large'].includes(code)?code:'invalid_response');
        if(Number.isInteger(cause?.retryAfterSeconds))out.retryAfterSeconds=cause.retryAfterSeconds;
        throw out;
      }
    } finally {
      clearTimeout(timer);controller.abort();
      try {if(response?.status!==200)await response?.body?.cancel?.();}catch{}
    }
    await sleep(retryDelay);
  }
}
