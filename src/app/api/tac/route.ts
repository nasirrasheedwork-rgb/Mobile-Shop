import { modelFields } from "@/lib/schema";

export async function GET(request: Request) {
  const tac = new URL(request.url).searchParams.get("tac") ?? "";
  if (!/^\d{8}$/.test(tac)) return new Response(null, { status: 400 });
  if (!process.env.TAC_LOOKUP_URL) return new Response(null, { status: 404 });
  try {
    const url = new URL(process.env.TAC_LOOKUP_URL);
    url.searchParams.set("tac", tac);
    const token = process.env.TAC_LOOKUP_TOKEN;
    const response = await fetch(url, {
      cache: "no-store", signal: AbortSignal.timeout(3000),
      headers: token ? { Authorization: "Bearer " + token } : {},
    });
    if (!response.ok) return new Response(null, { status: 404 });
    const model = modelFields.pick({ brand: true, model: true }).passthrough().parse(await response.json());
    return Response.json(modelFields.parse({
      storage: "", ram: "", color: "", specs: {}, default_cost: 0, default_price: 0, ...model, tac_codes: [tac],
    }));
  } catch {
    return new Response(null, { status: 502 });
  }
}
