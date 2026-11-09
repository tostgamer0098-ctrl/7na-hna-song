const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STATE = Object.freeze({ enabled: false, message: '' });
const MAX_MESSAGE_LENGTH = 500;

function normalizeState(value) {
  if (!value || typeof value.enabled !== 'boolean') {
    throw new Error('Maintenance state must contain a boolean enabled field.');
  }
  return {
    enabled: value.enabled,
    message: typeof value.message === 'string'
      ? value.message.trim().slice(0, MAX_MESSAGE_LENGTH)
      : '',
  };
}

function loadMaintenanceState(filePath) {
  if (!fs.existsSync(filePath)) return { ...DEFAULT_STATE };

  try {
    return normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch (err) {
    console.error('Could not read saved maintenance state:', err.message);
    return {
      enabled: true,
      message: 'Maintenance mode is active because saved settings could not be read.',
    };
  }
}

function saveMaintenanceState(filePath, state) {
  const normalized = normalizeState(state);
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  return normalized;
}

module.exports = {
  loadMaintenanceState,
  saveMaintenanceState,
};
