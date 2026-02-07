/**
 * Shared constants for the persistent browser daemon.
 */

export const BROWSER_DAEMON_PORT = 4000;
export const BROWSER_DAEMON_CONTAINER_NAME = 'openmoose-browser-daemon';
export const BROWSER_DAEMON_API_URL = `http://localhost:${BROWSER_DAEMON_PORT}`;
export const BROWSER_DAEMON_EXECUTE_URL = `${BROWSER_DAEMON_API_URL}/execute`;
export const BROWSER_DAEMON_HEALTH_URL = `${BROWSER_DAEMON_API_URL}/health`;
export const BROWSER_IMAGE_PREFIX = 'openmoose-browser';
