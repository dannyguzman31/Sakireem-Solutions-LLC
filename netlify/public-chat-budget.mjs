export async function reservePublicReply(store, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const dailyLimit = 100;
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await store.getWithMetadata(day, { type: "json", consistency: "strong" });
    const used = current?.data ?? 0;
    if (!Number.isInteger(used) || used < 0) throw new Error("Invalid chat counter");
    if (used >= dailyLimit) return false;
    const condition = current ? { onlyIfMatch: current.etag } : { onlyIfNew: true };
    if (current && !current.etag) throw new Error("Missing chat counter version");
    const result = await store.setJSON(day, used + 1, condition);
    if (result.modified) return true;
  }
  throw new Error("Could not reserve chat capacity");
}
