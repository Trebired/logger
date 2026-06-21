import type { RequestLoggerOptions } from "#tvzweoxg5ahk";
import { toString } from "#ycytzc4gr3f7";

function requestId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function buildRequestMiddleware(log: any, defaults?: RequestLoggerOptions) {
  const baseOptions = defaults || {};

  return function requestLogger(options?: RequestLoggerOptions) {
    const cfg = { ...baseOptions, ...(options || {}) };
    const group = toString(cfg.group) || "http.request";
    const idHeader = toString(cfg.idHeader);
    const attach = cfg.attach !== false;

    return (req: any, res: any, next: () => void) => {
      const headerValue =
        idHeader && req && req.headers && req.headers[idHeader.toLowerCase()]
          ? req.headers[idHeader.toLowerCase()]
          : "";
      const req_id = toString(Array.isArray(headerValue) ? headerValue[0] : headerValue) || requestId();
      const commonMeta = {
        req_id,
        host: req && req.hostname ? req.hostname : req && req.headers ? req.headers.host : null,
        method: req && req.method ? req.method : null,
        path: req && (req.originalUrl || req.url) ? req.originalUrl || req.url : null,
        subdomain: res && res.locals && res.locals.currentSubdomain ? res.locals.currentSubdomain : "main",
      };

      if (attach && req && typeof req === "object") req.log = log.withScope(null, group).child(commonMeta);
      if (typeof next === "function") next();
    };
  };
}

export { buildRequestMiddleware };
