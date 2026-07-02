import apiHandler from "../../api/[...path].mjs";

function headersToObject(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
}

function getRoutePath(event) {
  const rawPath = event.path || "";
  const marker = "/api/";
  const index = rawPath.indexOf(marker);
  if (index >= 0) return rawPath.slice(index + marker.length);
  return rawPath.replace(/^\/+/, "");
}

function createResponse() {
  const response = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = JSON.stringify(body);
      return this;
    },
    end(body = "") {
      this.body = body;
      return this;
    },
  };
  return response;
}

export async function handler(event) {
  const routePath = getRoutePath(event);
  const req = {
    method: event.httpMethod,
    headers: headersToObject(event.headers),
    query: { path: routePath.split("/").filter(Boolean) },
    body: event.body ? JSON.parse(event.body) : {},
  };
  const res = createResponse();
  await apiHandler(req, res);
  return {
    statusCode: res.statusCode,
    headers: res.headers,
    body: res.body,
  };
}
