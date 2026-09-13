// Pipeline-only transport: retry failed requests, including interrupted bodies.
const originalFetch = global.fetch;
global.fetch = async (url, options={}) => {
  let failure;
  for(let attempt=0;attempt<3;attempt++) {
    const timeout=AbortSignal.timeout(90000);
    const signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
    const headers=new Headers(options.headers);
    if(!headers.has('User-Agent'))headers.set('User-Agent','NakupniSeznamCatalog/1.0');
    try {
      const response=await originalFetch(url,{...options,headers,signal});
      if(response.status===429||response.status>=500)throw Error(`HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();
      const cleanHeaders=new Headers(response.headers);cleanHeaders.delete('content-encoding');cleanHeaders.delete('content-length');
      return new Response(bytes,{status:response.status,statusText:response.statusText,headers:cleanHeaders});
    } catch(error) {
      failure=error;
      if(options.signal?.aborted)throw error;
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
    }
  }
  throw failure;
};
