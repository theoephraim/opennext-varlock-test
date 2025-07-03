import { scanForLeaks } from "./runtime";

export function patchResponseToPreventClientLeaks() {
  if (!(globalThis.Response as any)._patchedByVarlock) {
    console.log('⚡️patching Response');
    const _UnpatchedResponse = globalThis.Response;
    globalThis.Response = class VarlockPatchedResponse extends _UnpatchedResponse {
      static _patchedByVarlock = true;
      constructor(body: any, init: any) {
        // console.log('⚡️ patched Response constructor');
        super(scanForLeaks(body, { method: 'patched Response constructor' }) as any, init);
      }
      static json(data: any, init: any) {
        // console.log('patched Response.json');
        scanForLeaks(JSON.stringify(data), { method: 'patched Response.json' });
        const r = _UnpatchedResponse.json(data, init);
        Object.setPrototypeOf(r, Response.prototype);
        return r;
      }
    };
  }
}