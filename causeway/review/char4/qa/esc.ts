// Which escape each QA round id stages at the capture multiplier.
import { escapeStaging } from '../../../src/world/choreo';
import { multiplierAtSmooth } from '../../../src/engine/curve';
const m = multiplierAtSmooth(22000 + 4900);
console.log('mult', m.toFixed(2));
for (const id of ['r-a', 'r-b', 'r-c', 'r-d', 'r-e', 'r-f', 'r-g', 'r-h', 'r-i', 'r-y']) console.log(id, escapeStaging(id, m, false).variant);
