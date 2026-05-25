import { select } from '@inquirer/prompts';
import clipboard from 'clipboardy';
import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

export interface CopyableItem {
  label: string;
  text: string;
}

// ============================================================================
// Interactive copy loop
// ============================================================================

export async function copyMenu(items: CopyableItem[]): Promise<void> {
  const usable = items.filter(i => i.text && i.text.trim().length > 0);

  if (usable.length === 0) {
    return;
  }

  while (true) {
    const choices = [
      ...usable.map((item, i) => ({ name: `${i + 1}. ${item.label}`, value: i })),
      { name: chalk.dim('Done'), value: -1 },
    ];

    let choice: number;

    try {
      choice = await select({
        message: 'Copy to clipboard:',
        choices,
        loop: false,
      });
    } catch {
      // User hit Ctrl-C or otherwise aborted the prompt — exit quietly.
      return;
    }

    if (choice === -1) {
      return;
    }

    try {
      await clipboard.write(usable[choice].text);
      console.log(chalk.green(`  ✓ Copied "${usable[choice].label}" to clipboard`));
    } catch (e) {
      console.log(chalk.yellow(`  ⚠ Could not copy to clipboard: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
}
