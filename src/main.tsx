import { Devvit } from '@devvit/public-api';
import {settingsforSuperUserPowers, checkSuperUserPowersEvents} from "./superusers.js";

Devvit.configure({
  redditAPI: true, // <-- this allows you to interact with Reddit's data api
  redis: true,    // Needed in utility
});

 Devvit.addSettings([
  settingsforSuperUserPowers
 ]);

Devvit.addTrigger({
  event: "CommentSubmit",
  onEvent: checkSuperUserPowersEvents,
});

export default Devvit;