const { loadPipelines, upsertPipeline } = require('./dist/lib/server/storage.js');
const { genId } = require('./dist/lib/id.js');

// Load all pipelines
const pipelines = loadPipelines();
console.log('Found', Object.keys(pipelines).length, 'pipelines');

// Fix each pipeline
for (const [id, pipeline] of Object.entries(pipelines)) {
  console.log(`\nFixing pipeline: ${pipeline.name}`);
  
  let modified = false;
  
  // Fix stage IDs
  pipeline.stages = pipeline.stages.map((stage, index) => {
    if (!stage.id) {
      console.log(`  - Assigning ID to stage: ${stage.label}`);
      stage.id = genId();
      modified = true;
    }
    
    // Fix task IDs
    stage.tasks = stage.tasks.map((task, taskIndex) => {
      if (!task.id) {
        console.log(`    - Assigning ID to task: ${task.label}`);
        task.id = genId();
        modified = true;
      }
      return task;
    });
    
    return stage;
  });
  
  // Save if modified
  if (modified) {
    upsertPipeline(id, pipeline);
    console.log(`  ✓ Updated pipeline with new IDs`);
  } else {
    console.log(`  - Pipeline already has IDs`);
  }
}

console.log('\nDone!');
