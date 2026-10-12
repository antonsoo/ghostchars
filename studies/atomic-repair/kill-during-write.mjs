// Deliberately terminate a disposable CLI child after a real partial write.
// The parent study supplies the one permitted original path. A staged writer
// passes a file descriptor instead. Never load this into an ordinary process.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const ordinaryWrite = fs.writeFileSync;
fs.writeFileSync = function (file, data, ...options) {
  if (typeof file === 'number' || file === process.env.GHOSTCHARS_STUDY_SOURCE) {
    const fd = typeof file === 'number' ? file : fs.openSync(file, 'w');
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    fs.writeSync(fd, bytes.subarray(0, 32));
    process.kill(process.pid, 'SIGKILL');
    throw new Error('SIGKILL did not terminate the disposable study process');
  }
  return ordinaryWrite.call(fs, file, data, ...options);
};
syncBuiltinESMExports();
