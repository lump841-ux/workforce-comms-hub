const { run } = require('../database/db');
const { id } = require('./ids');

function notify({ userId, type, title, body, link }) {
  const nid = id('ntf');
  run(
    `INSERT INTO notifications (id, user_id, type, title, body, link) VALUES (?,?,?,?,?,?)`,
    [nid, userId, type, title, body || null, link || null]
  );
  return nid;
}

function notifyMany(userIds, payload) {
  return userIds.map((uid) => notify({ ...payload, userId: uid }));
}

module.exports = { notify, notifyMany };
