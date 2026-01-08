CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`near_account_id` text NOT NULL,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cooccurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_a` text NOT NULL,
	`entity_b` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_count` integer DEFAULT 0 NOT NULL,
	`trajectory_count` integer DEFAULT 0 NOT NULL,
	`contributor_count` integer DEFAULT 0 NOT NULL,
	`last_updated` integer NOT NULL,
	FOREIGN KEY (`entity_a`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_b`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cooccurrence_pair_idx` ON `cooccurrence` (`entity_a`,`entity_b`);--> statement-breakpoint
CREATE INDEX `cooccurrence_a_idx` ON `cooccurrence` (`entity_a`);--> statement-breakpoint
CREATE INDEX `cooccurrence_b_idx` ON `cooccurrence` (`entity_b`);--> statement-breakpoint
CREATE TABLE `edge` (
	`id` text PRIMARY KEY NOT NULL,
	`source_entity_id` text NOT NULL,
	`target_entity_id` text NOT NULL,
	`relationship_type` text,
	`weight` integer DEFAULT 1 NOT NULL,
	`trajectory_count` integer DEFAULT 1 NOT NULL,
	`contributor_count` integer DEFAULT 1 NOT NULL,
	`positive_outcomes` integer DEFAULT 0 NOT NULL,
	`negative_outcomes` integer DEFAULT 0 NOT NULL,
	`mixed_outcomes` integer DEFAULT 0 NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`source_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edge_source_idx` ON `edge` (`source_entity_id`);--> statement-breakpoint
CREATE INDEX `edge_target_idx` ON `edge` (`target_entity_id`);--> statement-breakpoint
CREATE INDEX `edge_pair_idx` ON `edge` (`source_entity_id`,`target_entity_id`);--> statement-breakpoint
CREATE INDEX `edge_type_idx` ON `edge` (`relationship_type`);--> statement-breakpoint
CREATE INDEX `edge_weight_idx` ON `edge` (`weight`);--> statement-breakpoint
CREATE TABLE `entity` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`entity_type` text,
	`description` text,
	`touch_count` integer DEFAULT 0 NOT NULL,
	`trajectory_count` integer DEFAULT 0 NOT NULL,
	`contributor_count` integer DEFAULT 0 NOT NULL,
	`embedding` blob,
	`metadata` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `entity_name_idx` ON `entity` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `entity_type_idx` ON `entity` (`entity_type`);--> statement-breakpoint
CREATE INDEX `entity_touch_idx` ON `entity` (`touch_count`);--> statement-breakpoint
CREATE TABLE `entity_contribution` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`near_account_id` text NOT NULL,
	`first_trajectory_id` text NOT NULL,
	`touch_count` integer DEFAULT 1 NOT NULL,
	`trajectory_count` integer DEFAULT 1 NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_trajectory_id`) REFERENCES `trajectory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `contribution_entity_idx` ON `entity_contribution` (`entity_id`);--> statement-breakpoint
CREATE INDEX `contribution_account_idx` ON `entity_contribution` (`near_account_id`);--> statement-breakpoint
CREATE INDEX `contribution_pair_idx` ON `entity_contribution` (`entity_id`,`near_account_id`);--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`trajectory_id` text NOT NULL,
	`sequence_num` integer NOT NULL,
	`timestamp` integer NOT NULL,
	`event_type` text NOT NULL,
	`entity_id` text,
	`data` text,
	FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entity_id`) REFERENCES `entity`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_trajectory_idx` ON `event` (`trajectory_id`);--> statement-breakpoint
CREATE INDEX `event_entity_idx` ON `event` (`entity_id`);--> statement-breakpoint
CREATE TABLE `message` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`trajectory_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trajectory_id`) REFERENCES `trajectory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trajectory` (
	`id` text PRIMARY KEY NOT NULL,
	`near_account_id` text NOT NULL,
	`conversation_id` text,
	`input_text` text NOT NULL,
	`input_hash` text NOT NULL,
	`summary` text,
	`embedding` blob,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `trajectory_account_idx` ON `trajectory` (`near_account_id`);--> statement-breakpoint
CREATE INDEX `trajectory_conversation_idx` ON `trajectory` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `trajectory_input_hash_idx` ON `trajectory` (`input_hash`);