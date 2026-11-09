# Gastos en pareja

Aplicación web instalable para registrar gastos comunes y personales entre dos personas. Calcula quién le debe a quién. No se conecta a bancos.

- `docs/`: sitio publicado en GitHub Pages.
- `supabase/schema.sql`: tablas, permisos y funciones.

## Privacidad

Cada hogar admite dos cuentas. Ambas ven los gastos comunes y los pagos entre ellas; los gastos personales solo los ve quien los registró. La base aplica estas reglas, no el navegador. Los datos se guardan en Supabase, y los administradores del proyecto pueden acceder a ellos.

## Configuración

1. Aplique `supabase/schema.sql` en un proyecto de Supabase.
2. Complete `docs/config.js` con la URL y la clave publicable del proyecto. Nunca use allí una clave secreta o `service_role`.
3. Publique `docs/` en GitHub Pages.
4. En Supabase, en Authentication > URL Configuration, use la dirección publicada como Site URL y como Redirect URL.

Al publicar cambios, incremente `CACHE` en `docs/sw.js`.
