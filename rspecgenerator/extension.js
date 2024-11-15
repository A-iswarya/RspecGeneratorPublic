const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');

// Fetch RSpec from Flask API
async function fetchRSpecFromFlask(methodCode) {
    try {
        const response = await axios.post('https://e0a0-34-91-162-211.ngrok-free.app/', { input: methodCode });
        const responseData = response.data.result;

        // Match RSpec content within ```ruby markers or fallback to match ### Response section
        let rspecMatch = responseData.match(/### Response:\s*```ruby([\s\S]*?)```/);
        if (!rspecMatch) {
            rspecMatch = responseData.match(/### Response:\s*([\s\S]*?)(<\|end_of_text\|>|###|$)/);
        }

        // Get matched RSpec content and replace described_class with described_class.new
        let rspecContent = rspecMatch ? rspecMatch[1].trim() : null;
        if (rspecContent) {
            rspecContent = rspecContent.replace(/\bdescribed_class\b/g, 'described_class.new');
        }

        return rspecContent;
    } catch (error) {
        vscode.window.showErrorMessage(`Error fetching RSpec from Flask API: ${error.message}`);
        return null;
    }
}

// Get the path of the corresponding spec file
function getSpecFilePath(filePath) {
    const relativePath = filePath.replace(/^.*\/app\//, '');
    const specFilePath = path.join('spec', relativePath.replace(/\.rb$/, '_spec.rb'));
    return path.resolve(vscode.workspace.rootPath, specFilePath);
}

// Check if RSpec already exists for the method
function methodExistsInRSpec(data, methodName) {
    const regex = new RegExp(`describe\\s+['"](?:#|\\.|POST |GET |PUT |PATCH |DELETE )?${methodName}['"]`, 'i');
    return regex.test(data);
}

// Handle RSpec insertion into the spec file
async function handleRSpecInsertion(specFilePath, rspecContent, methodName) {
    if (!fs.existsSync(specFilePath)) {
        vscode.window.showErrorMessage(`Spec file not found: ${specFilePath}`);
        return;
    }

    fs.readFile(specFilePath, 'utf8', (err, data) => {
        // Insert RSpec content at the end of the file
        const updatedContent = data.replace(/end\n$/, `${rspecContent}\nend\n`);
        fs.writeFile(specFilePath, updatedContent, 'utf8', (err) => {
            if (err) {
                vscode.window.showErrorMessage(`Failed to update RSpec file: ${err.message}`);
            } else {
                vscode.window.showInformationMessage(`RSpec added for method '${methodName}'`);
            }
        });
    });
}

// Returns the type of file based on its directory path (controller, model, or service).
function detectType(filePath) {
    if (filePath.includes('/controllers/')) return 'controller';
    if (filePath.includes('/models/')) return 'model';
    if (filePath.includes('/services/')) return 'service';
    return null;
}

// Generates an RSpec describe block title based on the file path, adjusting for class naming conventions.
function generateRSpecTitle(filePath) {
    let relativePath = filePath.replace(/^.*\/app\//, '');
    let classPath = relativePath.replace(/\.rb$/, '');
    let className = classPath.split('/').map(segment =>
        segment.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('')
    ).join('::');

    className = className.replace(/^Controllers::/, '');
    className = className.replace(/^Models::/, '');
    className = className.replace(/^Services::/, '');

    return `RSpec.describe ${className}, type: :${detectType(filePath)} do\n`;
}

// Generates the content of an RSpec file with the given title and standard Rails test setup.
function generateRSpecFileContent(rspecTitle) {
    return `require 'rails_helper'\n\n${rspecTitle}\nend\n`;
}

// Creates an RSpec file at the specified path with the generated content and shows a success or error message.
function createRSpecFile(specFilePath, rspecTitle) {
    const content = generateRSpecFileContent(rspecTitle);
    fs.writeFile(specFilePath, content, (err) => {
        if (err) {
            vscode.window.showErrorMessage(`Failed to create RSpec file: ${err.message}`);
        } else {
            vscode.window.showInformationMessage(`RSpec file created: ${specFilePath}`);
        }
    });
}

// Process the selection (method/class) in the editor
async function processSelection(editor) {
    const filePath = editor.document.fileName;

    if (!filePath.includes('/app/')) {
        vscode.window.showErrorMessage("This command only works for files in the app directory");
        return;
    }

    const fileType = detectType(filePath);
    if (!fileType) {
        vscode.window.showErrorMessage("RSpec generation is not supported for this file type.");
        return;
    }

    const specFilePath = getSpecFilePath(filePath);
    if (!fs.existsSync(specFilePath)) {
        const rspecTitle = generateRSpecTitle(filePath);
        const specDir = path.dirname(specFilePath);
        fs.mkdirSync(specDir, { recursive: true });
        createRSpecFile(specFilePath, rspecTitle);
    }

    const selection = editor.selection;
    const selectedText = editor.document.getText(selection).trim();

    if (!selectedText) {
        vscode.window.showErrorMessage("No method or class selected.");
        return;
    }

    const fileContent = editor.document.getText();

    if (/^[A-Z]/.test(selectedText)) { // Class name
        const classMethods = Array.from(fileContent.matchAll(/def\s+(\w+)/g), match => match[1]);

        // Check RSpec for each method in the class
        for (const method of classMethods) {
            const methodCode = fileContent.match(new RegExp(`def\\s+${method}([\\s\\S]*?)(?=\\bdef\\b|$)`))[0].trim();
            try {
                // Read the RSpec file content
                const data = await fs.promises.readFile(specFilePath, 'utf8');

                // Check if RSpec already exists for the method
                if (methodExistsInRSpec(data, method)) {
                    vscode.window.showInformationMessage(`RSpec for method '${method}' already exists.`);
                    continue;
                }

                // Fetch RSpec from Flask API if it doesn't exist
                const rspecContent = await fetchRSpecFromFlask(methodCode);
                if (rspecContent) {
                    await handleRSpecInsertion(specFilePath, rspecContent, method);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Error processing method '${method}': ${err.message}`);
            }
        }
    } else { // Method name
        fs.readFile(specFilePath, 'utf8', (err, data) => {
            if (err) {
                vscode.window.showErrorMessage(`Failed to read RSpec file: ${err.message}`);
                return;
            }

            // Check if RSpec already exists for the method
            if (methodExistsInRSpec(data, selectedText)) {
                vscode.window.showInformationMessage(`RSpec for method '${selectedText}' already exists.`);
                return;
            }

            // Proceed to fetch RSpec from Flask API
            const methodCode = fileContent.match(new RegExp(`def\\s+${selectedText}([\\s\\S]*?)(?=\\bdef\\b|$)`))[0].trim();
            fetchRSpecFromFlask(methodCode).then(rspecContent => {
                if (rspecContent) {
                    handleRSpecInsertion(specFilePath, rspecContent, selectedText);
                }
            });
        });
    }
}

// Generate dataset (using Ruby script)
async function generateDataset() {
    // Prompt user for the Rails project root and limit
    const projectRoot = await vscode.window.showInputBox({
        prompt: "Enter the Rails project root directory",
        placeHolder: "e.g., /path/to/rails/project",
    });

    const limit = await vscode.window.showInputBox({
        prompt: "Enter the limit for dataset generation (number of methods)",
        placeHolder: "e.g., 100",
        validateInput: (input) => {
            if (isNaN(input)) {
                return "Limit must be a number";
            }
            return null;
        },
    });

    if (!projectRoot || !limit) {
        vscode.window.showErrorMessage("Project root and limit are required.");
        return;
    }

    try {
        // Call your Ruby script here to generate the dataset
        const rubyScriptPath = path.join(__dirname, 'generate_dataset.rb');
        const command = `ruby ${rubyScriptPath} ${projectRoot} ${limit}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Error generating dataset: ${stderr}`);
                return;
            }
            vscode.window.showInformationMessage(`Dataset generated successfully.`);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error generating dataset: ${error.message}`);
    }
}

// Register the commands in VS Code
function activate(context) {
    let disposableGenerateRSpec = vscode.commands.registerCommand('rspecgenerator.generate', async function () {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor found");
            return;
        }

        await processSelection(editor);
    });

    let disposableGenerateDataset = vscode.commands.registerCommand('rspecgenerator.generateDataset', function () {
        generateDataset();
    });

    context.subscriptions.push(disposableGenerateRSpec, disposableGenerateDataset);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
