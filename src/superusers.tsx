import {CommentSubmit} from "@devvit/protos";
import {getSubredditName, isModerator, getCurrentScore} from "./utility.js";
import {SettingsFormField, TriggerContext} from "@devvit/public-api";

enum superUserPowerSettingName {
    EnableSuperUserPostRemoval = "EnableSuperUserPostRemoval",
    SuperUserPointsThreshold = "superUserPointsThreshold",
    SuperUserPostRemovalUserList = "SuperUserPostRemovalUserList",
    SuperUserPostRemovalCommentPrefix = "SuperUserPostRemovalCommentPrefix",
    SuperUserPostRemovalToolboxRulePrefix = "SuperUserPostRemovalToolboxRulePrefix",
    SkipApprovedPosts = "SkipApprovedPosts",
    EnhancedLogging = "enhancedLogging"
}
 

export const settingsforSuperUserPowers: SettingsFormField = {

    type: "group",
    label: "Excel Bot Features",
    helpText: "Bot features for /r/Excel",
    fields: [
        {
            name: superUserPowerSettingName.EnableSuperUserPostRemoval,
            type: "boolean",
            label: "Enable Super User Post Removal",
            defaultValue: true
        },
        {
            name: superUserPowerSettingName.SuperUserPointsThreshold,
            type: "string",
            label: "Minimum number of points to automatically inherit this ability (0 = disabled)",
            defaultValue: "100"
        },
        {
            name: superUserPowerSettingName.SuperUserPostRemovalUserList,
            type: "string",
            label: "Additional users to specify (who may not meet the points minimum, or if the limit is disabled)"
        },
        {
            name: superUserPowerSettingName.SuperUserPostRemovalCommentPrefix,
            type: "string",
            label: "Comment prefix for rule trigger removal e.g. \"!rule\"",
            defaultValue: "!rule"
        },
        {
            name: superUserPowerSettingName.SuperUserPostRemovalToolboxRulePrefix,
            type: "string",
            label: "The prefix of the rule saved in Toolbox e.g. \"R1 - abc...\" - R would be the prefix",
            defaultValue: "R"
        },
        {
            name: superUserPowerSettingName.SkipApprovedPosts,
            type: "boolean",
            label: "Do not remove posts that are already approved",
            defaultValue: false
        },        
        {
            name: superUserPowerSettingName.EnhancedLogging,
            type: "boolean",
            label: "Enhanced logging",
            defaultValue: true
        }
    ],
};


async function enhancedLog(context: TriggerContext, printMessage: string) {

    // Function only displays print statements when Enhanced Logging option is set to true

    const settings      = await context.settings.getAll();
    const enhancedLogging = settings[superUserPowerSettingName.EnhancedLogging] as boolean;

    // If enhancedLogging is enabled, display this log
    if (enhancedLogging) {
        console.log('\t# ', printMessage);
    }

}


export async function checkSuperUserPowersEvents (event: CommentSubmit, context: TriggerContext) {

    if (!event.comment || !event.post || !event.author || !event.subreddit) {
        console.log("ERROR - Event is not in the required state\n");
        return;
    }

    const comment   = await context.reddit.getCommentById(event.comment.id);  
    
    // Ignore any comments by AutoModerator, to not clog up the logs
    const usernamesToIgnore = ['AutoModerator']
    if (usernamesToIgnore.includes(comment.authorName) || event.author.id == context.appAccountId ){
        return
    }

    await enhancedLog(context, `Triggered by ${comment.id}`)
    const user          = await context.reddit.getUserByUsername(event.author.name);
    const username      = user.username
    const post          = await context.reddit.getPostById(event.post.id);
    const subredditName = await getSubredditName(context);

    const settings      = await context.settings.getAll();

    // If the entire function is disabled, do nothing
    const superUserPostRemovalEnabled = settings[superUserPowerSettingName.EnableSuperUserPostRemoval] as boolean;
    if (!superUserPostRemovalEnabled) {
        await enhancedLog(context, `superUserPostRemovalEnabled not enabled.\n`);
        return;
    }

    // Check if the comment contains the trigger prefix
    const superUserPostRemovalCommentPrefix = settings[superUserPowerSettingName.SuperUserPostRemovalCommentPrefix] as string;
    if (comment.body.toLowerCase().startsWith(superUserPostRemovalCommentPrefix)) {
        console.log(`${comment.id} Found super user comment with post removal trigger.`);

        // Remove the trigger comment after it's been triggered
        if (!comment.isRemoved()) {
            await enhancedLog(context, `Trigger comment removed.`);
            comment.remove()
        }
    }
    else {
            await enhancedLog(context, `${comment.id} triggered - no prefix.\n`)
        return
    }

    // Skip posts already approved by a mod
    const skipApprovedPosts = settings[superUserPowerSettingName.SkipApprovedPosts] as boolean;
    if (skipApprovedPosts) {
        if (post.isApproved()) {
            console.log(`### Post already mod approved - skipping...\n`)
            await context.reddit.sendPrivateMessage({
                subject: `Post removal failed on ${subredditName}!`,
                text: `The [post you tried to remove](${comment.permalink}) was already approved by a moderator.`,
                to: username});
            return
        }
    }

    // List of superusers who can overwrite the limits
    const superUserSetting = settings[superUserPowerSettingName.SuperUserPostRemovalUserList] as string ?? "";
    const superUsers = superUserSetting.split(",").map(user => user.trim().toLowerCase());

    // If a number is specific, this means they must meet this requirement
    const superUserPointsThreshold = settings[superUserPowerSettingName.SuperUserPointsThreshold] as number;

    // Check if mod, then check if superuser, then check points
    if (await isModerator(context, subredditName, username)) {
        console.log(`${username} is a moderator!`)
    }
    else if (superUsers.includes(username.toLowerCase())) {
        console.log(`${username} is on super user list!`)
    }
    else if (superUserPointsThreshold > 0) {
        // If they're not on the super user list, check if there's a points requirement
        // If there is a points requirement, ensure they meet it
        const currentScore = await getCurrentScore(user, context);
        if (currentScore < superUserPointsThreshold) {
            console.log(`${user} does not have enough points to user SuperUser features (${currentScore}/${superUserPointsThreshold})\n`);
            return
        }
    }
    else {
        // If they're not a mod or super user, and they don't meet the points requirement, then it's over
        await enhancedLog(context, `${comment.id} did not meet conditions for SuperUser and no points threshold set!\n`)
        return
    }

    // At this point, the user is either a super user, or has met the points threshold
    await enhancedLog(context, `Reading toolbox data from ${subredditName} wiki...`)

    // Get the data in JSON format, and extract the portfion we need
    const toolboxMarkdown = JSON.parse((await context.reddit.getWikiPage(subredditName, 'toolbox')).content);
    const removalReasons = toolboxMarkdown['removalReasons']['reasons']

    // From the commment, extract the trigger word, to get the (most likely) rule number
    const triggerInComment = comment.body.split(' ')[0].trim() as string;

    await enhancedLog(context, `triggerInComment ${triggerInComment}`)

    // Extract the removal rule by removing the prefix
    const removalRuleNumber = triggerInComment.replace(superUserPostRemovalCommentPrefix, '') as string; // Ignore anything after a space, if provided

    // The prefix of the rule saved in Toolbox - might be different
    const superUserPostRemovalToolboxRulePrefix = settings[superUserPowerSettingName.SuperUserPostRemovalToolboxRulePrefix] as string;

    // Confirm it's valid
    if (!removalRuleNumber) {
        console.log(`removalRuleNumber: '${removalRuleNumber}' invalid!\n`)
        return
    }
    else {
        await enhancedLog(context, `Found removalRuleNumber: ${removalRuleNumber}`)
    };

    // Now find which position that removal rule is in the JSON by getting the index (base = 0)
    // It takes the roolbox rule prefix and adds it to the removal reason number retrieved e.g. "R" and "2" as it would be saved in Toolbox
    const removalReasonIndex = removalReasons.findIndex((reason: { title: string; })  => reason.title.startsWith(`${superUserPostRemovalToolboxRulePrefix}${removalRuleNumber}`));

    // If not found, quit
    if (removalReasonIndex !== -1) {
        await enhancedLog(context, `Found reason index: ${removalReasonIndex}`);
    } else {
        console.log(`Abort - reason '${triggerInComment}' not found.\n`);
        return
    }

    // If it's valid, get the removal reason
    const removalReason = removalReasons[removalReasonIndex];

    // Confirm it's valid
    if (!removalReason) {
        console.log(`triggerInComment: '${triggerInComment}' removal reason not found!\n`)
        return
    };

    // Define all the post flairs, if required
    let postFlairText = removalReason['flairText'] as string | undefined;
    let postFlairCSSClass = removalReason['flairCSS'] as string| undefined;
    let postFlairTemplate = removalReason['flairTemplateID'] as string | undefined;

    // Grab if set
    if (!postFlairText) {
        postFlairText = undefined;
    }

    if (!postFlairCSSClass || postFlairTemplate) {
        postFlairCSSClass = undefined;
    }

    if (!postFlairTemplate) {
        postFlairTemplate = undefined;
    }

    await enhancedLog(context, `postFlairText: ${postFlairText}`)
    await enhancedLog(context, `postFlairCSSClass: ${postFlairCSSClass}`)
    await enhancedLog(context, `postFlairTemplate: ${postFlairTemplate}`)

    // Check if there's text to leave behind
    let postRemovedComment = removalReason['text'] as string | undefined;

    if (!postRemovedComment) {
        postRemovedComment = undefined;
    }

    // Always remove (that is the point of this script)
    post.remove()
    await enhancedLog(context, `Post removed...\n`)
 
    // If any of these are provided, apply the flair
    if (postFlairText || postFlairCSSClass || postFlairTemplate) {
        console.log('Setting flair...')
        await context.reddit.setPostFlair({
            postId: post.id,
            subredditName: subredditName,
            text: postFlairText,
            flairTemplateId: postFlairTemplate,
        });
    }

    if (postRemovedComment) {

        // Remove any existing sticky
        const commentsOnPost = await post.comments.all();
        const existingSticky = commentsOnPost.find(comment => comment.isStickied());

        if (!existingSticky) {
            const newComment = await context.reddit.submitComment({id: post.id, text: decodeURI(postRemovedComment)});

        await Promise.all([
            newComment.distinguish(true),
            newComment.lock(),
        ]);

        console.log(`Removal comment stickied.`);
    }}

    console.log(`Post ${post.id} removed by ${username}.`)
}