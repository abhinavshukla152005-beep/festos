import 'dotenv/config';
import app from './app.js';
import { liveModeAvailable } from './qloo.js';

const PORT = Number(process.env.PORT) || 8787;

app.listen(PORT, () => {
  console.log(`FestOS API on http://localhost:${PORT} (${liveModeAvailable ? 'live Qloo' : 'demo data'})`);
});
