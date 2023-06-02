const path = require('path');
const core = require('@actions/core');
const tmp = require('tmp');
const fs = require('fs');
const { Liquid } = require('liquidjs');

async function run() {
  try {
    // Get inputs
    const taskDefinitionFile = core.getInput('task-definition', { required: true });
    const containerName = core.getInput('container-name', { required: true });
    const imageURI = core.getInput('image', { required: true });

    const environmentVariables = core.getInput('environment-variables', { required: false });
    const dockerLabels = core.getInput('docker-labels', { required: false });

    // Parse the task definition
    const taskDefPath = path.isAbsolute(taskDefinitionFile) ?
      taskDefinitionFile :
      path.join(process.env.GITHUB_WORKSPACE, taskDefinitionFile);

    if (!fs.existsSync(taskDefPath)) {
      throw new Error(`Task definition file does not exist: ${taskDefinitionFile}`);
    }

    const templateVariables = core.getInput('template-variables', { required: false });

    var rendered;
    if (templateVariables) {
      const context = {};
      parseVariables(templateVariables).forEach(function (variable) {
        context[variable.name] = variable.value;
      });

      const engine = new Liquid();
      const text = fs.readFileSync(taskDefPath, { encoding: 'utf8', flag: 'r' });
      console.log("Text: " + text);
      rendered = engine.parseAndRenderSync(text, context);
    }

    const taskDefContents = rendered !== undefined ? JSON.parse(rendered) : require(taskDefPath);

    // Insert the image URI
    if (!Array.isArray(taskDefContents.containerDefinitions)) {
      throw new Error('Invalid task definition format: containerDefinitions section is not present or is not an array');
    }
    const containerDef = taskDefContents.containerDefinitions.find(function (element) {
      return element.name == containerName;
    });
    if (!containerDef) {
      throw new Error('Invalid task definition: Could not find container definition with matching name');
    }
    containerDef.image = imageURI;

    if (dockerLabels) {

      // If dockerLabels object is missing, create it
      if (!containerDef.dockerLabels) {
        containerDef.dockerLabels = {};
      }

      parseVariables(dockerLabels).forEach(function(variable) {
        containerDef.dockerLabels[variable.name] = variable.value;
      });
    }

    if (environmentVariables) {

      // If environment array is missing, create it
      if (!Array.isArray(containerDef.environment)) {
        containerDef.environment = [];
      }

      parseVariables(environmentVariables).forEach(function (variable) {
        // Search container definition environment for one matching name
        const variableDef = containerDef.environment.find((e) => e.name == variable.name);
        if (variableDef) {
          // If found, update
          variableDef.value = variable.value;
        } else {
          // Else, create
          containerDef.environment.push(variable);
        }
      });
    }

    // Write out a new task definition file
    var updatedTaskDefFile = tmp.fileSync({
      tmpdir: process.env.RUNNER_TEMP,
      prefix: 'task-definition-',
      postfix: '.json',
      keep: true,
      discardDescriptor: true
    });
    const newTaskDefContents = JSON.stringify(taskDefContents, null, 2);
    fs.writeFileSync(updatedTaskDefFile.name, newTaskDefContents);
    core.setOutput('task-definition', updatedTaskDefFile.name);
  }
  catch (error) {
    core.setFailed(error.message);
  }
}

function parseVariables(variableText) {
  return variableText.split('\n').map(function (line) {
    // Trim whitespace
    const trimmedLine = line.trim();
    // Skip if empty
    if (trimmedLine.length === 0) { return; }
    // Split on =
    const separatorIdx = trimmedLine.indexOf("=");
    // If there's nowhere to split
    if (separatorIdx === -1) {
      throw new Error(`Cannot parse the line '${trimmedLine}'. Pairs must be of the form NAME=value.`);
    }
    // Build object
    return {
      name: trimmedLine.substring(0, separatorIdx),
      value: trimmedLine.substring(separatorIdx + 1),
    };
  });
}

module.exports = run;

/* istanbul ignore next */
if (require.main === module) {
  run();
}
