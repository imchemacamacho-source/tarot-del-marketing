# El Tarot del Marketing

Flujo: formulario → `POST /api/lead` en Vercel → `doPost` de Apps Script → pestaña `Registros` → confirmación de guardado → cartas.

## Integración

- Vercel ejecuta `api/lead.js`. Apps Script ejecuta únicamente `google-apps-script/Code.gs`.
- `LEADS_WEBHOOK_URL` debe ser la URL HTTPS de la aplicación web terminada en `/exec`, configurada en Vercel para cada entorno que reciba registros. Nunca se incluye en el navegador ni en Git.
- Apps Script escribe en la hoja indicada en `SPREADSHEET_ID`, dentro de `Registros`. Conserva los doce encabezados existentes, incluyendo Estado del lead y Observaciones, y añade `ID de registro` en M para evitar filas duplicadas al reintentar.
- Apps Script devuelve JSON con `ok`, `stored`, `row`, `sheet` y `registrationId` solo después de escribir, ejecutar `SpreadsheetApp.flush()` y comprobar la fila. Vercel rechaza HTML, errores de Google y respuestas sin ese comprobante.
- El formulario mantiene el mismo ID durante un reintento y solo muestra las cartas al confirmar el guardado. Ante un fallo temporal repite automáticamente la solicitud una vez, sin crear una fila adicional. El diseño y las cartas se conservan.
- Las columnas Carta 1–3 y Clic en WhatsApp no se usan para seguimiento en el formulario actual. Este arreglo registra los datos del formulario y el consentimiento; no atribuye selecciones ni clics que no se enviaron.

## Publicación de Apps Script (configuración única)

1. En el proyecto «Tarot del Marketing – Registro de leads», sustituir `Code.gs` por `google-apps-script/Code.gs` de este repositorio y guardar.
2. En **Implementar → Administrar implementaciones**, editar la aplicación web y seleccionar **Nueva versión**. Mantener la ejecución como el propietario y el acceso necesario para el webhook de Vercel. No ejecutar `doPost` desde el botón Ejecutar: requiere un evento HTTP POST.
3. Conservar la URL `/exec` existente. Si se crea otra implementación y cambia la URL, actualizar `LEADS_WEBHOOK_URL` en Vercel y desplegar nuevamente; las variables nuevas no modifican despliegues anteriores.
4. Enviar un registro ficticio desde el sitio, completar la lectura y buscar el mismo nombre y WhatsApp en `Registros`. La prueba se considera terminada solo después de ese readback real.

## Verificación local

Con Node.js 20 o superior:

```sh
node --test test/integration.test.js
```

Estas pruebas verifican validación, errores HTTP 200 de Apps Script, guardado con comprobante, reintentos sin duplicados y conservación del diseño. Usan una hoja simulada y no sustituyen una prueba publicada contra Google Sheets.
