---
name: mango-node-chat
description: Post an explicitly requested Node chat with optional normal @mentions or urgent !mentions using Mango's saved chat and notification actions. Load before posting Node chats or mentions, including during Process execution.
---

# Chat on a Node

Send only when the user requests a chat or notification, or explicitly requests execution of a bound Process whose authored Step requires it. Discussing a message or mentioning a person in conversation does not authorize sending.

1. Resolve the exact Node through current permission-filtered Mango reads and choose its exact existing textbox. Ask when the destination is ambiguous. During bound Process execution, use only the tracked Node and the textbox returned by write_process_node; send_process_node_chat supplies that Node's identity on the server.
2. Resolve requested recipients with list_chat_users using their name or email. Narrow the query if has_more is true. Use returned exact user IDs only when each person is unambiguous; otherwise ask. Normal @mentions use mentioned_user_ids; urgent !mentions use urgent_user_ids only when urgency was requested. Put each recipient in one list and use empty lists when no mention is requested. Never invent users, IDs, email addresses, groups, or mention tokens.
3. Send the message once with send_node_chat, or send_process_node_chat in a bound Process. Supply plain message text and the separate recipient ID lists; Mango adds the actual mention tokens and stores the chat under the authenticated user. Do not substitute a written simulation or a textbox note for a requested chat or mention.
4. Report a chat as posted and a mention as sent only after a successful saved result. A saved mention does not prove the recipient saw it. A failed or uncertain send stops the interaction; never repeat it automatically.

These actions send internal Mango chats and notifications. They do not send email, change email recipients, or perform external messaging. Existing Mango access and mention rules still apply.
