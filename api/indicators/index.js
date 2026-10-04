import { listIndicators } from "../../src/api.js";

export default function handler(req, res) {
  const { status, headers, body } = listIndicators();
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).send(JSON.stringify(body));
}
