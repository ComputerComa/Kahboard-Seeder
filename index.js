import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import inquirerFileTreeSelection from 'inquirer-file-tree-selection-prompt';
import YAML from 'yaml';

// Register the file tree selection plugin with inquirer
inquirer.registerPrompt('file-tree-selection', inquirerFileTreeSelection);

async function pickAndParseYaml() {
    try {
        // 1. Prompt the user to navigate and select a file
        const answers = await inquirer.prompt([
            {
                type: 'file-tree-selection',
                name: 'selectedFile',
                message: 'Select a YAML definition file:',
                basePath: './', // Start browsing from the current working directory
                enableGoUpperDirectory: true,
                // Optional: Filter to only show directories and .yaml/.yml files
                validate: (item) => {
                    const isDir = fs.lstatSync(item).isDirectory();
                    const isYaml = item.endsWith('.yaml') || item.endsWith('.yml');
                    return isDir || isYaml || 'Please select a valid YAML file.';
                }
            }
        ]);

        const filePath = answers.selectedFile;

        // Ensure they didn't just select a folder
        if (fs.lstatSync(filePath).isDirectory()) {
            console.log('❌ You selected a directory. Please choose a file.');
            return;
        }

        console.log(`\nLoading: ${path.basename(filePath)}...`);

        // 2. Read and dynamically parse the file
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const parsedConfig = YAML.parse(fileContent);

        // 3. Your loaded definition object is ready to use
        console.log('✅ Definition successfully loaded into object:\n');
        console.dir(parsedConfig, { depth: null, colors: true });

    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

pickAndParseYaml();
