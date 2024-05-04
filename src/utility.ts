import {addWeeks} from "date-fns";
import {TriggerContext, User} from "@devvit/public-api";

export function replaceAll (input: string, pattern: string, replacement: string): string {
    return input.split(pattern).join(replacement);
}


export async function isModerator (context: TriggerContext, subredditName: string, username: string): Promise<boolean> {
    const filteredModeratorList = await context.reddit.getModerators({subredditName, username}).all();
    return filteredModeratorList.length > 0;
}


export async function getSubredditName (context: TriggerContext): Promise<string> {
    const subredditName = await context.redis.get("subredditname");
    if (subredditName) {
        return subredditName;
    }

    const subreddit = await context.reddit.getCurrentSubreddit();
    await context.redis.set("subredditname", subreddit.name, {expiration: addWeeks(new Date(), 1)});
    return subreddit.name;
}


export async function getCurrentScore (user: User, context: TriggerContext) {

    const subredditName = await getSubredditName(context);
    const userFlair = await user.getUserFlairBySubreddit(subredditName);

    let scoreFromFlair: number;
    if (!userFlair || !userFlair.flairText || userFlair.flairText === "-") {
        scoreFromFlair = 0;
    } else {
        scoreFromFlair = parseInt(userFlair.flairText);
    }

    const flairScoreIsNaN = isNaN(scoreFromFlair);
    if (flairScoreIsNaN) {
        scoreFromFlair = 0;
    }

    return scoreFromFlair
}