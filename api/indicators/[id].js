import { getIndicator } from "../../src/api.js";

export default async function handler(req, res) {
  const { status, headers, body } = await getIndicator(req.query.id);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).send(JSON.stringify(body));
}
