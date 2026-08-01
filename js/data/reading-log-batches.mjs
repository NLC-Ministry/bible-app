export function chunkUniqueValues(values = [], batchSize = 40) {
  const normalizedBatchSize = Math.max(1, Number(batchSize) || 40);
  const uniqueValues = Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || "").trim())
    .filter(Boolean)));
  const chunks = [];
  for (let index = 0; index < uniqueValues.length; index += normalizedBatchSize) {
    chunks.push(uniqueValues.slice(index, index + normalizedBatchSize));
  }
  return chunks;
}

export async function fetchReadingLogsByPlanIds(client, planIds = [], options = {}) {
  const batchSize = Math.max(1, Number(options.batchSize) || 40);
  const pageSize = Math.max(1, Math.min(200, Number(options.pageSize) || 200));
  const chunks = chunkUniqueValues(planIds, batchSize);
  if (!client || chunks.length === 0) return { data: [], error: null };

  const results = await Promise.all(chunks.map(async chunk => {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from("reading_logs")
        .select("id, user_id, book, chapter, read_at, plan_id, round")
        .in("plan_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { data: [], error };
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return { data: rows, error: null };
  }));

  const failed = results.find(result => result.error);
  if (failed) return { data: [], error: failed.error };
  return { data: results.flatMap(result => result.data), error: null };
}
