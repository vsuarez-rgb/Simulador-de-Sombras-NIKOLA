// Función serverless de Vercel: descarga el año meteorológico típico (TMY) de PVGIS y lo devuelve compacto.
// GET /api/pvgis?lat=-33.45&lon=-70.66
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: 'lat/lon inválidos' }, { status: 400 });
  }
  const api = `https://re.jrc.ec.europa.eu/api/v5_2/tmy?lat=${lat}&lon=${lon}&outputformat=json`;
  const r = await fetch(api);
  if (!r.ok) return Response.json({ error: `PVGIS respondió ${r.status}`, detalle: await r.text() }, { status: 502 });
  const data = await r.json();
  const rows: Record<string, number | string>[] = data?.outputs?.tmy_hourly ?? [];
  // time(UTC) = "20070101:0010" → mes, día, hora decimal
  const hours = rows.map(row => {
    const t = String(row['time(UTC)']);
    return {
      m: Number(t.slice(4, 6)), d: Number(t.slice(6, 8)), h: Number(t.slice(9, 11)) + Number(t.slice(11, 13)) / 60,
      ghi: Number(row['G(h)']) || 0, dni: Number(row['Gb(n)']) || 0, dhi: Number(row['Gd(h)']) || 0,
    };
  });
  return Response.json({ lat, lon, fuente: 'PVGIS v5.2 TMY', n: hours.length, hours }, {
    headers: { 'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400' },
  });
}
