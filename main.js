const { Plugin, Notice } = require("obsidian");

module.exports = class PropertyCacheFix extends Plugin {
	constructor() {
		super(...arguments);

		this.metadataTypeManager = null;
		this.metadataCache = null;
		this.originalUpdate = null;

		this.signatures = new Map();

		this.ready = false;
		this.refreshTimer = null;
		this.patchInstalled = false;
	}

	async onload() {
		const mtm = this.app.metadataTypeManager;
		const mc = this.app.metadataCache;

		/*
		 * Feature detection because metadataTypeManager and "finished"
		 * are internal Obsidian APIs.
		 */
		if (
			!mtm ||
			typeof mtm.updatePropertyInfoCache !== "function" ||
			typeof mtm.getTypeInfo !== "function" ||
			!mc ||
			typeof mc.on !== "function" ||
			typeof mc.off !== "function"
		) {
			console.error(
				"[Property Cache Fix] Required Obsidian internals not found."
			);

			new Notice(
				"Property Cache Fix: incompatible Obsidian version."
			);

			return;
		}

		this.metadataTypeManager = mtm;
		this.metadataCache = mc;
		this.originalUpdate = mtm.updatePropertyInfoCache;

		/*
		 * Metadata changes:
		 * Inspect only the changed file.
		 */
		this.registerEvent(
			mc.on("changed", (file, data, cache) => {
				this.onMetadataChanged(file, cache);
			})
		);

		/*
		 * Deleted Markdown file can remove the last occurrence
		 * of a property, therefore refresh when necessary.
		 */
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!file || file.extension !== "md") {
					return;
				}

				const oldSignature =
					this.signatures.get(file.path);

				this.signatures.delete(file.path);

				if (
					this.ready &&
					oldSignature !== undefined &&
					oldSignature !== "{}"
				) {
					this.scheduleRefresh("markdown file deleted");
				}
			})
		);

		/*
		 * Rename/move:
		 *
		 * Normally properties themselves do not change,
		 * but moving into/out of excluded paths can affect
		 * getAllPropertyInfos(), so refresh once for safety.
		 */
		this.registerEvent(
			this.app.vault.on(
				"rename",
				(file, oldPath) => {
					if (!file || file.extension !== "md") {
						return;
					}

					const signature =
						this.signatures.get(oldPath);

					this.signatures.delete(oldPath);

					if (signature !== undefined) {
						this.signatures.set(
							file.path,
							signature
						);
					}

					if (this.ready) {
						this.scheduleRefresh(
							"markdown file renamed/moved"
						);
					}
				}
			)
		);

		/*
		 * Manual emergency / verification command.
		 */
		this.addCommand({
			id: "refresh-property-cache",
			name: "Refresh global property cache",
			callback: () => {
				this.refreshNow("manual command");
			}
		});

		/*
		 * Wait until the Obsidian UI exists, then build our
		 * initial per-file property signatures.
		 */
		this.app.workspace.onLayoutReady(() => {
			const detach = () => {
				this.metadataCache.off(
					"finished",
					this.originalUpdate
				);

				this.patchInstalled = true;

				console.log(
					"[Property Cache Fix] Original full-vault refresh listener detached."
				);
			};

			/*
			 * First removal after Obsidian's layout is ready.
			 */
			detach();

			/*
			 * Startup guards in case Obsidian registers the internal
			 * listener slightly later during startup.
			 */
			const delays = [
				100,
				500,
				1000,
				2000,
				4000
			];

			for (const delay of delays) {
				window.setTimeout(detach, delay);
			}

			this.initialize().catch((error) => {
				console.error(
					"[Property Cache Fix] Initialization failed:",
					error
				);
			});
		});
	}

	async initialize() {
		const files = this.app.vault.getMarkdownFiles();

		/*
		 * Process in chunks instead of doing all ~10k files
		 * in one renderer task.
		 */
		const CHUNK_SIZE = 250;

		for (
			let start = 0;
			start < files.length;
			start += CHUNK_SIZE
		) {
			const end = Math.min(
				start + CHUNK_SIZE,
				files.length
			);

			for (let i = start; i < end; i++) {
				const file = files[i];

				const cache =
					this.metadataCache.getFileCache(file);

				this.signatures.set(
					file.path,
					this.getPropertySignature(
						cache?.frontmatter
					)
				);
			}

			/*
			 * Give renderer back to Obsidian between chunks.
			 */
			await new Promise((resolve) =>
				window.setTimeout(resolve, 0)
			);
		}

		/*
		 * Guarantee one correct initial property cache.
		 *
		 * This may cause ONE ~280 ms scan during startup,
		 * but not every two seconds afterwards.
		 */
		this.originalUpdate.call(
			this.metadataTypeManager
		);

		this.ready = true;

		console.log(
			`[Property Cache Fix] Ready. Tracking ${this.signatures.size} Markdown files.`
		);

		new Notice("Property Cache Fix active.");
	}

	onMetadataChanged(file, cache) {
		if (!file || file.extension !== "md") {
			return;
		}

		const newSignature =
			this.getPropertySignature(
				cache?.frontmatter
			);

		const oldSignature =
			this.signatures.get(file.path);

		this.signatures.set(
			file.path,
			newSignature
		);

		/*
		 * During startup we're only establishing baseline state.
		 */
		if (!this.ready) {
			return;
		}

		/*
		 * Existing normal note:
		 * Body text changes leave this signature identical.
		 */
		if (oldSignature === newSignature) {
			return;
		}

		/*
		 * Brand-new file without properties:
		 * no reason to rebuild global property information.
		 */
		if (
			oldSignature === undefined &&
			newSignature === "{}"
		) {
			return;
		}

		this.scheduleRefresh(
			`property structure changed: ${file.path}`
		);
	}

getPropertySignature(frontmatter) {
    if (
        !frontmatter ||
        typeof frontmatter !== "object"
    ) {
        return "{}";
    }

    const normalize = (value) => {
        if (
            value === null ||
            value === undefined
        ) {
            return value ?? null;
        }

        if (
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ) {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map(normalize);
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (typeof value === "object") {
            const result = {};

            for (
                const key of Object.keys(value).sort()
            ) {
                result[key] = normalize(value[key]);
            }

            return result;
        }

        return String(value);
    };

    return JSON.stringify(
        normalize(frontmatter)
    );
}

	scheduleRefresh(reason) {
		if (this.refreshTimer !== null) {
			window.clearTimeout(
				this.refreshTimer
			);
		}

		/*
		 * Batch several rapid property edits.
		 */
		this.refreshTimer =
			window.setTimeout(() => {
				this.refreshTimer = null;

				this.refreshNow(reason);
			}, 750);
	}

	refreshNow(reason) {
		if (
			!this.patchInstalled ||
			!this.originalUpdate
		) {
			return;
		}

		const start = performance.now();

		this.originalUpdate.call(
			this.metadataTypeManager
		);

		const elapsed =
			performance.now() - start;

		console.log(
			`[Property Cache Fix] Full property refresh: ${elapsed.toFixed(1)} ms (${reason})`
		);
	}

	onunload() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(
				this.refreshTimer
			);

			this.refreshTimer = null;
		}

		/*
		 * Restore vanilla Obsidian behavior.
		 */
		if (
			this.patchInstalled &&
			this.metadataCache &&
			this.metadataTypeManager &&
			this.originalUpdate
		) {
			/*
			 * Prevent accidental duplicate registration.
			 */
			this.metadataCache.off(
				"finished",
				this.originalUpdate
			);

			this.metadataCache.on(
				"finished",
				this.originalUpdate,
				this.metadataTypeManager
			);

			console.log(
				"[Property Cache Fix] Original Obsidian listener restored."
			);
		}

		this.patchInstalled = false;
	}
};