import jwt from "jsonwebtoken";

// Middleware: valida o token JWT enviado em "Authorization: Bearer <token>".
// Sem token válido, a requisição é barrada antes de chegar às rotas.
export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Autenticação necessária" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, name: payload.name, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida ou expirada" });
  }
}
