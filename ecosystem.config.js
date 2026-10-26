// pm2 cluster: несколько процессов Node на всех ядрах, общий порт (ШАГ 1 — кластеризация).
// Состояние партий — в Redis (REDIS_URL), рассылка событий — через Redis-адаптер socket.io.
//   pm2 start ecosystem.config.js
//   pm2 delete chess-cluster
module.exports = {
    apps: [{
        name: 'chess-cluster',
        script: 'server.js',
        instances: Number(process.env.CLUSTER_INSTANCES || 4), // или 'max' — по числу ядер
        exec_mode: 'cluster',
        env: {
            REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
        },
    }],
};
