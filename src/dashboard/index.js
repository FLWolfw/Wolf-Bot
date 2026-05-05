export function setupDashboard(app, client) {

  console.log('🔥 Dashboard cargado');

  app.get('/dashboard', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>WK' Bot</title>

        <style>
          body {
            margin: 0;
            font-family: 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #0f172a, #020617);
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }

          .card {
            background: rgba(255,255,255,0.05);
            backdrop-filter: blur(10px);
            padding: 30px;
            border-radius: 20px;
            text-align: center;
            box-shadow: 0 0 40px rgba(0,0,0,0.6);
            width: 350px;
          }

          .logo {
            width: 100px;
            height: 100px;
            border-radius: 50%;
            margin-bottom: 15px;
            border: 3px solid #22c55e;
          }

          h1 {
            margin: 10px 0;
          }

          .status {
            margin-top: 15px;
            padding: 10px;
            border-radius: 10px;
            background: #16a34a;
            font-weight: bold;
          }

          .info {
            margin-top: 10px;
            color: #cbd5f5;
          }
        </style>
      </head>

      <body>

        <div class="card">

          <!-- 🔥 CAMBIA ESTA IMAGEN -->
          <img class="logo" src="https://i.imgur.com/4M34hi2.png">

          <h1>WK' Bot</h1>

          <div class="status">
            ✅ Bot Online
          </div>

          <div class="info">
            Servidores: ${client.guilds.cache.size}
          </div>

        </div>

      </body>
      </html>
    `);
  });

}