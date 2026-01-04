// Types for Slack API responses that we need to handle
export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
}

export interface ConversationsListResponse extends SlackApiResponse {
  channels: Array<{
    id: string;
    name?: string;
    is_channel?: boolean;
    is_group?: boolean;
    is_im?: boolean;
    is_mpim?: boolean;
    is_private?: boolean;
    is_member?: boolean;
    num_members?: number;
  }>;
}

export interface ConversationsHistoryResponse extends SlackApiResponse {
  messages: Array<{
    ts: string;
    thread_ts?: string;
    user?: string;
    text?: string;
    type?: string;
    subtype?: string;
    reply_count?: number;
    reply_users_count?: number;
    latest_reply?: string;
    reactions?: Array<{
      name: string;
      count: number;
      users: string[];
    }>;
  }>;
  has_more?: boolean;
}

export interface ConversationsRepliesResponse extends SlackApiResponse {
  messages: Array<{
    ts: string;
    thread_ts?: string;
    user?: string;
    text?: string;
    type?: string;
    subtype?: string;
  }>;
  has_more?: boolean;
}

export interface SearchMessagesResponse extends SlackApiResponse {
  messages: {
    matches: Array<{
      ts: string;
      text: string;
      user?: string;
      channel: {
        id: string;
        name?: string;
      };
      permalink?: string;
    }>;
    paging?: {
      count: number;
      total: number;
      page: number;
      pages: number;
    };
  };
}

export interface ReactionsListResponse extends SlackApiResponse {
  items: Array<{
    type: 'message';
    channel: string;
    message: {
      ts: string;
      text?: string;
      reactions?: Array<{
        name: string;
        users: string[];
      }>;
    };
  }>;
  paging?: {
    count: number;
    total: number;
    page: number;
    pages: number;
  };
}

export interface ChatGetPermalinkResponse extends SlackApiResponse {
  channel: string;
  permalink: string;
}

export interface UsersInfoResponse extends SlackApiResponse {
  user: {
    id: string;
    name: string;
    real_name?: string;
    profile?: {
      display_name?: string;
    };
    is_bot?: boolean;
  };
}

export interface RateLimitError {
  ok: false;
  error: 'ratelimited';
  retryAfter: number;
}

export function isRateLimitError(response: SlackApiResponse): response is RateLimitError {
  return !response.ok && response.error === 'ratelimited';
}
