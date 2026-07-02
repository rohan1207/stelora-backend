export function errorHandler(err, _req, res, _next) {
  console.error(err);
  if (err.name === "ZodError") {
    return res.status(400).json({ error: "Validation failed", details: err.errors });
  }
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
}
