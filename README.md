# DayZ Lootmaster

This is a tool I've developed to help me manage my DayZ server's loot. I've implemented functionality that assists me in refining the CLE based on my own methods.
Types, spawnabletypes and events I place in a subdirectory for each mod I run, with a `vanilla_types` group for overriding the vanilla types.

So yeah - this tool is optimised for doing things my way, with each mod's CLE files (types / events / spawnablles) in their own directory, and loaded via cfgeconomycore.xml

# Server Requirements
Lootmaster will only work on a server that gives you access to the Windows / Windows Server desktop. You'll need to have the latest version of Node / npm installed globally.

## Server Side
Lootmaster is a single page app, and is served up via a Node.js server. The server does all of the reading and saving of your files.

# Installation
Clone the repo and run `npm install`

You'll need to have Node.js installed.

Then run `npm run dev`

# File Structure
Lootmaster is currently locked to a specific folder structure. It comes with the current types.xml for the vanilla Chernarus CLE.

## Minimum Setup
Place your cfg files in the `./data` folder.
- cfgeconomycore.xml
- cfglimitsdefinition.xml

## Recommended Structure
Place the `mpmissions/db/types.xml` file in the `./data/db` folder. Ideally, this would be the vanilla file.

### Types Groups
In the `./data/db/types` folder, create a directory for each **types group** - usually relating to types for specific mods.

### Example structure
```aiignore
data/
    cfgeconomycore.xml
    cfglimitsdefinition.xml
    db/
        types.xml
        types/
            mod1/
                types.xml
            mod2/
                types.xml
                
```
# Lootmastering

## Logging In
When you first load up, you'll be asked to enter a unique identifying username; in this way, if you have several people poking their nose into the CLE, you can see who's changed what.
When logged in, you'll see a list of all the types in the CLE on the right, with a filters panel opn the left for refining which types you can see in the list.

## Loading the Loot
The first time you load up, Lootmaster looks at `cfgeconomycore.xml` to look for possible custom types groups, and `cfglimitsdefinition.xml` for the types, usages, values, flags and categories

### Warnings

If your types have usage, value, category or tag values that are not defined in cfglimitsdefinition.xml, you'll be given the option to either add them to definitions or remove them from the affected types.

## Filtering
You can filter by:
- Types group (if you have more than the vanilla CLE)
- Wildcard string search on type name
- Category
- Usage
- Value (ie Tiers)
- Tags
- Flags

Category, Usage, Value and Flags allow you to filter by 'None', as well as a combination of possible values.

## Managing Definitions

You can add or remove from definitions loaded through your cfglimitsdefinition.xml file.

In the filter panel, click the 'manage' link next to the labels.

This will open a popup that shows you info on the number currently defined (limited to 32 by DayZ) and allow you to add or delete.

## Editing
To edit a type or types, click on the name in the types list. You can select multiple types to edit at once - hold Ctrl to select additional, OR select one and then hold Shift while clicking another to select a range. You can also click the 'select all' option next to the 'Name' column header.

### Editing a Single Type
Pretty intuitive; existing values are filled in, and you change, remove or add new values.
Lifetime is displayed in human-readable format below the input field for Lifetime, and clicking on the small clock icon next to the Lifetime label displays a helper popup for easily computing the time in seconds that you're after.

Click 'Save' to save your changes or 'Cancel' to discard them.

### Editing Multiple Types
If you've selected multiple types, editing works a little differently.

Fields that are the same for all of the selected types are displayed as normal, but fields that are not the same for all of the selected types are 'indeterminate'.
#### Indeterminate Fields
You can leave these untouched, and these fields won't be changed for the selected types.
For 'input' fields (nominal, min, lifetime, restock, quantmin and quantmax) you'll see they are marked as 'Mixed'. If you edit these fields, the value you enter will be applied to all the selected types.

For usage, value, flags and tags, indeterminate fields have the checkbox filled with a horizontal line. If you check this checkbox, this value be applied to all the selected types.

Now, click 'Save' to save your changes or 'Cancel' to discard them.

Types that have been edited will now show in the list with a slightly different text colour.

### Undo / Redo

There's Undo and redo icons at the top of the page.

## Saving to ./data
As soon as you make a change, the 'Set Changes Live' button at the top becomes active. Clicking this will save your changes to the `cfgeconomycore.xml` and `cfglimitsdefinition.xml` files as well as any types that have changed.

## Preview current changes

The exclamation icon at the top of the page will show you a preview of the changes that will be made when you save.


