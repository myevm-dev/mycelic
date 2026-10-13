export const runtime = "nodejs";
const disabled = () =>
  Response.json(
    { error: "Mycelic chat is ephemeral. Archives are disabled." },
    { status: 410 },
  );
export const GET = disabled;
export const POST = disabled;
