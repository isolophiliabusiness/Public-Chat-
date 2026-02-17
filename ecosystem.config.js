module.exports = {
  apps: [
    // ===== Dev Mode =====
    {
      name: "chat-dev",
      script: "./server.js",
      watch: true,
      env: {
        NODE_ENV: "development",
        PORT_HTTP: 3000,   // dev http port
        PORT_HTTPS: 8444,  // dev https port
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ===== Prod Main Fork =====
    {
      name: "chat-prod-main",
      script: "./server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT_HTTP: 8080,   // prod main http
        PORT_HTTPS: 8443,  // prod main https
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },

    // ===== Prod Cluster =====
    {
      name: "chat-prod-cluster",
      script: "./server.js",
      instances: 2,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT_HTTP: 3001,   // cluster http
        PORT_HTTPS: 8445,  // cluster https
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],

  // ===== Logrotate Module =====
  deploy: {},
};
