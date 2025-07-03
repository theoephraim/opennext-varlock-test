import { patchConsole } from './patch-console';
import { patchServerResponseToPreventClientLeaks } from './patch-server-response';
import { patchResponseToPreventClientLeaks } from './patch-response';

patchConsole();
patchServerResponseToPreventClientLeaks();
patchResponseToPreventClientLeaks();
