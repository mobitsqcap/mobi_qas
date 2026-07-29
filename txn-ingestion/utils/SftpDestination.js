const { getDestination } = require('@sap-cloud-sdk/connectivity');
function normalizeRemotePath(value) { const raw = String(value || '').trim(); if (!raw) return ''; if (raw === '/') return '/'; return raw.replace(/\/+$/, ''); }
function normalizeHost(value) {
  let raw = String(value || '').trim();
  const mm = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/); if (mm) raw = mm[1];
  raw = raw.replace(/^https?:\/\//i, '').replace(/^sftp:\/\//i, '').replace(/\/+$/, '');
  return raw;
}
async function getSFTPDestination() {
  const dest = await getDestination({ destinationName: 'SFTP_MOBI' });
  if (!dest) throw new Error('Destination SFTP_MOBI not found');
  const props = dest.originalProperties || {};
  const config = { host: normalizeHost(props.sftpHost || props.URL || props.url || dest.url || ''), port: Number(props.sftpPort || 22), username: props.sftpUser, password: props.sftpPassword, remotePath: normalizeRemotePath(props.remotePath || ''), readyTimeout: Number(props.sftpReadyTimeout || 60000), keepaliveInterval: Number(props.sftpKeepaliveInterval || 15000), keepaliveCountMax: Number(props.sftpKeepaliveCountMax || 10) };
  const missing = ['host', 'username', 'password'].filter((k) => !config[k]);
  if (missing.length) throw new Error(`Destination SFTP_MOBI missing properties: ${missing.join(', ')}`);
  return config;
}
module.exports = { getSFTPDestination };
