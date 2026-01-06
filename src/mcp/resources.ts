import { getSlackClient } from '@/core/slack/client.js';
import { createLogger } from '@/utils/logging/index.js';

const logger = createLogger({ component: 'McpResources' });
import type { Resource } from '@modelcontextprotocol/sdk/types.js';

export function getResources(): Resource[] {
  return [
    {
      uri: 'slack://workspace/info',
      name: 'Slack Workspace Info',
      mimeType: 'application/json',
      description: 'Current workspace details and authenticated user info',
    },
    {
      uri: 'slack://channels/list',
      name: 'Channel Directory',
      mimeType: 'application/json',
      description: 'All channels the user is a member of',
    },
  ];
}

interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

export async function handleResourceRead(uri: string): Promise<ResourceContent> {
  const slackClient = getSlackClient();

  switch (uri) {
    case 'slack://workspace/info': {
      logger.info('Fetching workspace info resource');

      const auth = await slackClient.authenticate();
      const userId = auth.user_id;
      const displayName = await slackClient.getUserDisplayName(userId);

      const workspaceInfo = {
        workspace: {
          team: auth.team,
          team_id: auth.team_id,
        },
        user: {
          user_id: auth.user_id,
          username: auth.user,
          display_name: displayName,
        },
      };

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(workspaceInfo, null, 2),
      };
    }

    case 'slack://channels/list': {
      logger.info('Fetching channel directory resource');

      const channels = await slackClient.listChannels();
      const channelList = channels.map((ch) => ({
        id: ch.id,
        name: ch.name,
        type: getChannelType(ch),
        num_members: ch.num_members,
        is_member: ch.is_member,
      }));

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ channels: channelList }, null, 2),
      };
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

function getChannelType(channel: {
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
}): string {
  if (channel.is_im) return 'im';
  if (channel.is_mpim) return 'mpim';
  if (channel.is_private) return 'private_channel';
  return 'public_channel';
}
