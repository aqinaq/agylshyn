/* Supabase connection for cloud progress sync.

   BOTH VALUES ARE PUBLIC AND SAFE TO COMMIT. The "anon" key is designed to ship
   in client JS; it grants nothing on its own — `progress` has row-level security
   (see tools/supabase_schema.sql), so a request can only reach rows whose
   user_id matches the signed-in user. Never put the *service_role* key here.

   Leave them empty and the app behaves exactly as before: no account button, no
   network calls, progress stays local-only. That is the intended default for
   anyone running this from a fork or off the filesystem.

   Setup (once):
     1. supabase.com → New project. Copy Project URL and the anon/public key
        from Settings → API into the two fields below.
     2. SQL Editor → paste and run tools/supabase_schema.sql.
     3. Authentication → URL Configuration → add the site URL to
        "Redirect URLs" (e.g. https://aqinaq.github.io/agylshyn/site/ and
        http://localhost:8777/ for local work). Magic links and Google both
        come back through this list; a URL that is not on it is rejected.
     4. Authentication → Providers → enable Google and paste a Google Cloud
        OAuth client id + secret. Email (password + magic link) is on already.
*/
window.SUPABASE = {
  url: 'https://jdrngcsoswrwphcufcam.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impkcm5nY3Nvc3dyd3BoY3VmY2FtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNDc5MzEsImV4cCI6MjEwMDYyMzkzMX0.fexbWBBfnv0QtT4GS7xcODcAvEOBIxC5wTcf47eXoDw'
};
