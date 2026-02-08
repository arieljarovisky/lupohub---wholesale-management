**Objetivo**
- Conectar el frontend React (Vite) a la API Express, eliminando dependencias de datos mock donde aplique y garantizando manejo robusto de errores y configuración de entorno.

**Contexto Detectado**
- Frontend: React + Vite con capa HTTP y API:
  - Cliente HTTP y configuración de base URL/token: [httpClient.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/httpClient.ts)
  - Servicios de dominio con fallback demo: [api.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/api.ts)
  - Pantalla de Configuración para Base URL y Token: [Settings.tsx](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/components/Settings.tsx)
  - Consumo en la app: [App.tsx](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/App.tsx)
- Backend: Express + TS con CORS habilitado y rutas:
  - Registro de rutas y CORS: [index.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/index.ts)
  - Productos: [products.routes.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/routes/products.routes.ts), [products.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/products.controller.ts)
  - Pedidos: [orders.routes.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/routes/orders.routes.ts), [orders.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/orders.controller.ts)

**Plan de Cambios (Frontend)**
- Configuración de entorno
  - Añadir VITE_API_URL en .env de frontend (desarrollo y producción):
    - Desarrollo: VITE_API_URL=http://localhost:3001/api
    - Producción: VITE_API_URL=<URL_backend>/api
  - Verificar lectura de VITE_API_URL en [httpClient.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/httpClient.ts#L3) y permitir override desde Configuración.
- Consumo real de API
  - Mantener llamadas reales ya implementadas en [api.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/api.ts):
    - Productos: GET/POST/PATCH a /products y /products/:id/stock
    - Pedidos: GET/POST/PATCH a /orders y /orders/:id/status
  - Eliminar uso de mocks en flujos críticos al conectar correctamente:
    - Cargar productos/pedidos desde API en [App.tsx](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/App.tsx#L46-L61)
    - Mantener mocks solo para entidades sin backend (usuarios, clientes, atributos, visitas) hasta que existan endpoints.
- Manejo de errores y modo demo
  - Mantener el fallback de [api.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/api.ts#L6-L13) para escenarios offline.
  - Añadir un indicador visual de conexión (Healthcheck a GET /health) en Configuración para guiar al usuario si el backend no responde.
- Autenticación
  - Backend no requiere auth actualmente; mantener soporte opcional de Bearer en [httpClient.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/httpClient.ts#L11-L15) por si se agrega más adelante.
- UX de Configuración
  - Asegurar que la pantalla de Configuración guarda Base URL y Token y actualiza el cliente: [Settings.tsx](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/components/Settings.tsx#L73-L85).

**Verificación Funcional**
- Preparación
  - Iniciar backend en puerto 3001 y confirmar /health responde OK: [index.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/index.ts#L23-L25).
  - Definir VITE_API_URL y arrancar frontend.
- Pruebas manuales
  - Productos
    - Listar productos y validar campos (incluye integrations desde DB): [products.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/products.controller.ts#L6-L19).
    - Crear producto y verificar duplicados SKU manejados con 409: [products.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/products.controller.ts#L40-L47).
    - Actualizar stock y ver reflejo en UI: [products.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/products.controller.ts#L50-L65).
  - Pedidos
    - Listar pedidos con items: [orders.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/orders.controller.ts#L6-L36).
    - Crear pedido y confirmar persistencia: [orders.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/orders.controller.ts#L38-L66).
    - Cambiar estado y validar actualización: [orders.controller.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/controllers/orders.controller.ts#L68-L78).
- Robustez
  - Simular backend caído y confirmar fallback demo sin bloquear la UI.
  - Verificar timeouts, mensajes de error y abort en [httpClient.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/frontend/services/httpClient.ts#L27-L63).

**Despliegue**
- Configurar VITE_API_URL en variables de entorno del hosting del frontend.
- Asegurar CORS habilitado (ya activo): [index.ts](file:///c:/Users/usuario/Desktop/lupohub---wholesale-management/backend/src/index.ts#L15).
- Documentar Base URL y uso opcional de token para futuros endpoints de auth.

¿Quieres que proceda a implementar estos cambios y ajustar la UI de Configuración con un healthcheck y mensajes de conectividad?