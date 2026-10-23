// Preserve the media API name while sharing one shift authorization policy.
const { shiftForSession } = require('./shiftAccess');
module.exports = { mediaShiftForSession: shiftForSession };
