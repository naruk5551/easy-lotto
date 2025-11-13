SELECT b.id AS batch_id, b."from", b."to",
       ex."productId", p.category, p.number,
       SUM(ex.amount)::numeric AS total_send
FROM "SettleBatch" b
JOIN "ExcessBuy" ex ON ex."batchId" = b.id
LEFT JOIN "Product" p ON p.id = ex."productId"
GROUP BY b.id, b."from", b."to", ex."productId", p.category, p.number
ORDER BY b.id DESC, total_send DESC;