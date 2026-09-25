'use strict';

/*
 * The Node face of scripts/growspace-repos. Where the main hub checkout is and
 * where a sibling repository lives are answered there and nowhere else; this
 * only asks it, so a Node script run from a hub worktree finds the same trees a
 * shell script does.
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RESOLVER = path.join(__dirname, 'growspace-repos');

function resolve(...args) {
  return execFileSync(RESOLVER, args, { encoding: 'utf8' }).trim();
}

/* The main hub checkout: the one that owns the runtime and its `.ha-token`. */
function mainHub() {
  return resolve('--hub');
}

/* Where sibling `name` lives, whether or not it has been cloned. */
function siblingRepo(name) {
  return resolve(name);
}

module.exports = { mainHub, siblingRepo };
